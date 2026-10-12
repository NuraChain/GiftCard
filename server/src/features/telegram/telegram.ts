// Telegram, used for two things the operator cannot get any other way: a ping when something
// sells, and the database itself, once an hour, somewhere that is not this machine.
//
// WHAT NEVER GOES DOWN THIS PIPE: a gift code. A code is bearer value - whoever reads it can
// spend it - which is why the logger redacts `code` and why the console shows one only behind
// a session. A purchase notification carrying the code would put the shop's inventory into a
// chat history, on the operator's phone, synced to Telegram's servers, forever. The
// notification says what sold and for how much; the code stays where it is.
//
// THE BACKUP IS THE OPPOSITE CASE and the tension is worth stating out loud. The database file
// contains every unsold code, so mailing it to a chat is exactly the thing the paragraph above
// refuses - and it is still right, because a shop whose only copy of its inventory is one disk
// is one disk failure away from losing all of it. The mitigation is not secrecy, it is that
// the operator chooses the destination: a private chat with their own bot. That decision is
// theirs to make, and this file's job is to be clear about what it is.
//
// `fetch` is INJECTED the same way the gateway, SMS sender and rate sources take it: it is
// what lets every path here be tested without a network or a bot token.
//
// THROUGH A PROXY, WHEN THE CONSOLE LISTS ONE. The same request to the same API host - only the
// road changes. See ./proxy.ts for what a proxy can and cannot see of it.
import type { TelegramProxy } from '../../contract/shared.ts';
import type { Fetch } from '../checkout/zarinpal.ts';
import { throughProxy } from './proxy.ts';

/** What the client needs, read fresh per call so the console can change it without a restart. */
export interface TelegramSettings {
    /** From @BotFather. Empty means Telegram is off, and everything here becomes a no-op. */
    botToken: string;

    /** Where messages go. A user id, a group id, or a channel like `@ashbringerops`. */
    chatId: string;

    /** The API host. A setting because a shop behind a filtered network may need a relay. */
    baseUrl: string;

    /** Proxies to reach the API host through, attempted in order before going straight to it. */
    proxies?: TelegramProxy[];
}

export type TelegramResult = { ok: true } | { ok: false; reason: string };

/** What trying one proxy found. `ms` is how long Telegram took to answer through it. */
export interface ProxyTest {
    ok: boolean;
    reason: string;
    ms: number;
}

/** One message the bot was sent, reduced to the three things a command needs. */
export interface TelegramUpdate {
    /** Telegram's own sequence number. The next poll asks for everything after it. */
    updateId: number;

    /** The chat it arrived in, as a string. Compared against the configured one - see below. */
    chatId: string;

    /** `@name` of the chat, when it has one. A channel is configured by name, not by id. */
    chatUsername: string;

    text: string;
}

/** What the app depends on - two methods, so a test can hand it a spy. */
export interface Telegram {
    /** True when a token and a chat are configured. Nothing is attempted otherwise. */
    configured(): boolean;

    sendMessage(text: string): Promise<TelegramResult>;

    sendDocument(filename: string, bytes: Uint8Array, caption: string): Promise<TelegramResult>;

    /**
     * LONG-POLLS for messages sent TO the bot, for however many seconds are asked for.
     *
     * Returns an empty list for every failure - not configured, unreachable, a body that will
     * not parse - because the only caller is a loop that must keep going regardless.
     *
     * ONE CONSUMER PER BOT, and Telegram enforces it: a second poller, or a webhook registered
     * against the same token, makes this fail with a 409 and the two steal each other's
     * messages. Run one of these.
     */
    receive(offset: number, seconds: number): Promise<TelegramUpdate[]>;

    /** Tries ONE proxy, saved or not. It needs nothing else - not the token, not the chat. */
    testProxy(proxy: TelegramProxy): Promise<ProxyTest>;
}

export interface TelegramOptions {
    settings: () => TelegramSettings;
    fetch?: Fetch;

    /** A `fetch` that goes through one proxy. Injected for the reason `fetch` is. */
    through?: (proxy: TelegramProxy) => Fetch;

    /** A backup upload is slower than a message, so the two get different budgets. */
    timeoutMs?: number;
    uploadTimeoutMs?: number;
}

/** @internal What Telegram puts on the wire, as much of it as `receive` reads. */
interface RawUpdate {
    update_id?: unknown;
    message?: {
        text?: unknown;
        chat?: { id?: unknown; username?: unknown };
    };
}

function ready(live: TelegramSettings): boolean {
    return live.botToken !== '' && live.chatId !== '';
}

/** @internal As much of a Bot API answer as anything here reads. */
interface Answer {
    ok?: boolean;
    description?: string;
    result?: unknown;
}

/**
 * @internal Why a request through a proxy failed, in the words the console shows beside it.
 *
 * `fetch` says "fetch failed" and nothing else. What went wrong - the proxy refusing the
 * tunnel, the wrong password, a name that does not resolve - is the cause underneath it.
 */
function reasonOf(error: unknown): string {
    let at = error;
    while (at instanceof Error && at.cause instanceof Error) {
        at = at.cause;
    }
    if (at instanceof AggregateError && at.errors[0] instanceof Error) {
        // One per address the name resolved to, and they all say the same thing.
        [at] = at.errors as Error[];
    }
    if (!(at instanceof Error) || at.message === '') {
        return 'proxy unreachable';
    }
    // OpenSSL words a failed handshake as a line of hex and a source file. Its code reads.
    const { code } = at as NodeJS.ErrnoException;
    return typeof code === 'string' && code.startsWith('ERR_SSL_')
        ? `TLS failed: ${code}`
        : at.message;
}

/** @internal What a road is known by: the proxy, password and all, or the API host itself. */
function keyOf(road: TelegramProxy | null): string {
    return road === null ? 'direct' : JSON.stringify(road);
}

/** How long a proxy that failed is left alone before it is tried again. */
const REST_MS = 60_000;

export function createTelegram(options: TelegramOptions): Telegram {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const through = options.through ?? throughProxy;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const uploadTimeoutMs = options.uploadTimeoutMs ?? 120_000;

    /** The road that last reached Telegram, which is the one to start on. */
    let last: string | null = null;

    /**
     * The proxies that failed, and when each may be tried again. Kept in the order they failed
     * in, so the first one in it is the one that has been left alone longest.
     */
    const resting = new Map<string, number>();

    /**
     * @internal The roads worth trying now: the one that last worked, then every proxy that is
     * not resting, in the order listed, then the API host with nothing in between.
     *
     * NEITHER RULE IS ABOUT SPEED ALONE. A sale and a payout both wait on a message, and the
     * command loop asks for updates without pause. Walking a list of dead proxies on every one
     * of those, a timeout apiece, would make the bot slower with each row the operator adds.
     *
     * A REST IS FOR A PROXY THERE IS AN ALTERNATIVE TO. With every proxy resting, the API host
     * alone is all that is left - and a shop lists proxies because it cannot reach that. So one
     * resting proxy gets a turn anyway, the one left alone longest: a single dropped connection
     * must not be a minute in which every sale and payout goes unannounced. One, not all of
     * them, which keeps a list that really is dead from costing more than a single attempt.
     */
    function roads(live: TelegramSettings): Array<TelegramProxy | null> {
        const now = Date.now();
        for (const [key, until] of resting) {
            if (until <= now) {
                resting.delete(key);
            }
        }
        const listed = live.proxies ?? [];
        const open: Array<TelegramProxy | null> = listed.filter(
            (proxy) => !resting.has(keyOf(proxy))
        );
        if (open.length === 0) {
            const rested = [...resting.keys()]
                .map((key) => listed.find((proxy) => keyOf(proxy) === key))
                .find((proxy) => proxy !== undefined);
            if (rested !== undefined) {
                open.push(rested);
            }
        }
        open.push(null);
        return [
            ...open.filter((road) => keyOf(road) === last),
            ...open.filter((road) => keyOf(road) !== last)
        ];
    }

    /**
     * @internal One Bot API call, by the first road that reaches Telegram. It never throws, and
     * null means no road got there.
     *
     * AN ANSWER ENDS THE WALK, whatever it says. A refusal - a bad token, a chat that is not
     * there - is Telegram's, and every other road leads to the same Telegram. Only a road that
     * did not arrive is a reason to take the next.
     */
    async function ask(
        live: TelegramSettings,
        path: string,
        body: BodyInit,
        headers: Record<string, string>,
        budget: number
    ): Promise<{ status: number; answer: Answer } | null> {
        for (const road of roads(live)) {
            const key = keyOf(road);
            try {
                const response = await (road === null ? call : through(road))(
                    `${live.baseUrl}/bot${live.botToken}/${path}`,
                    { method: 'POST', headers, body, signal: AbortSignal.timeout(budget) }
                );
                const answer = (await response.json()) as Answer | null;
                if (answer === null || typeof answer !== 'object') {
                    throw new Error('not a Bot API answer');
                }
                last = key;
                resting.delete(key);
                return { status: response.status, answer };
            } catch {
                if (last === key) {
                    last = null;
                }
                if (road !== null) {
                    // Deleted first, so that it goes to the back of the order it is kept in.
                    resting.delete(key);
                    resting.set(key, Date.now() + REST_MS);
                }
            }
        }
        return null;
    }

    /**
     * @internal One send. Telegram answers a refusal with 200 and
     * `{"ok":false,"description":"..."}` as often as it does with a 4xx, so the BODY decides,
     * not the status - and `description` is the only part of it worth an operator's time.
     */
    async function send(
        path: string,
        body: BodyInit,
        headers: Record<string, string>,
        budget: number
    ): Promise<TelegramResult> {
        const live = options.settings();
        if (!ready(live)) {
            return { ok: false, reason: 'telegram is not configured' };
        }
        const reply = await ask(live, path, body, headers, budget);
        if (reply === null) {
            return { ok: false, reason: 'telegram unreachable' };
        }
        if (reply.answer.ok === true) {
            return { ok: true };
        }
        return {
            ok: false,
            reason: reply.answer.description ?? `telegram returned ${reply.status}`
        };
    }

    return {
        configured: () => ready(options.settings()),

        sendMessage(text: string): Promise<TelegramResult> {
            return send(
                'sendMessage',
                JSON.stringify({
                    chat_id: options.settings().chatId,
                    text,
                    // No parse mode. Telegram's Markdown and HTML modes both REJECT the whole
                    // message when a stray character in interpolated data looks like markup,
                    // and the data here includes a mobile number someone else chose. A
                    // notification that silently fails to arrive is worse than a plain one.
                    disable_web_page_preview: true
                }),
                { 'content-type': 'application/json' },
                timeoutMs
            );
        },

        sendDocument(filename, bytes, caption): Promise<TelegramResult> {
            const form = new FormData();
            form.set('chat_id', options.settings().chatId);
            form.set('caption', caption);
            // The filename matters: Telegram shows it, and it is what the operator will be
            // looking at in a list of hourly backups when they need one.
            form.set('document', new Blob([bytes as BlobPart]), filename);

            // No content-type header: fetch sets it, WITH the multipart boundary. Setting it
            // by hand omits the boundary and the upload is rejected as malformed.
            return send('sendDocument', form, {}, uploadTimeoutMs);
        },

        async receive(offset, seconds): Promise<TelegramUpdate[]> {
            const live = options.settings();
            if (!ready(live)) {
                return [];
            }
            const reply = await ask(
                live,
                'getUpdates',
                JSON.stringify({
                    offset,
                    timeout: seconds,
                    // Only messages. Without this the bot is also handed edits, reactions
                    // and join events, every one of which would have to be skipped here.
                    allowed_updates: ['message']
                }),
                { 'content-type': 'application/json' },
                // The HTTP request is held open for the whole poll, so the budget has to
                // outlast it. A timeout equal to the poll would abort every quiet cycle.
                seconds * 1000 + timeoutMs
            );
            // A timeout, a dropped connection, a body that is not JSON: all the same thing
            // to the loop upstairs - nothing arrived this cycle.
            if (reply?.answer.ok !== true || !Array.isArray(reply.answer.result)) {
                return [];
            }
            return (reply.answer.result as RawUpdate[]).flatMap(readUpdate);
        },

        async testProxy(proxy): Promise<ProxyTest> {
            const startedAt = Date.now();
            try {
                // ANY ANSWER IS A PASS. The request goes down a tunnel to the API host, so
                // whatever comes back came from there - which proves the three things a proxy
                // can get wrong: it is up, it takes this login, and it reaches Telegram. No
                // token goes with it: this asks about the proxy, and the test message is what
                // asks about the bot.
                const response = await through(proxy)(options.settings().baseUrl, {
                    redirect: 'manual',
                    signal: AbortSignal.timeout(timeoutMs)
                });
                void response.body?.cancel();
                // One that has just answered is not one to go on leaving alone.
                resting.delete(keyOf(proxy));
                return { ok: true, reason: '', ms: Date.now() - startedAt };
            } catch (error) {
                return { ok: false, reason: reasonOf(error), ms: Date.now() - startedAt };
            }
        }
    };
}

/**
 * @internal One update, if it is a text message. Everything here is UNTRUSTED: it is written by
 * whoever messaged the bot, which is anybody who can find it. Nothing is assumed to be present
 * or to be the type it should be, and an update that is not a plain text message is dropped
 * rather than half-read.
 */
function readUpdate(raw: RawUpdate): TelegramUpdate[] {
    const id = raw.update_id;
    const text = raw.message?.text;
    const chatId = raw.message?.chat?.id;
    if (typeof id !== 'number' || typeof text !== 'string') {
        return [];
    }
    if (typeof chatId !== 'number' && typeof chatId !== 'string') {
        return [];
    }
    const username = raw.message?.chat?.username;
    return [
        {
            updateId: id,
            chatId: String(chatId),
            chatUsername: typeof username === 'string' ? `@${username}` : '',
            text
        }
    ];
}
