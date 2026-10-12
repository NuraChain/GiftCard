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
// TWO WIRES, ONE BOT. With no proxies this is plain HTTPS to the Bot API. An MTProto proxy
// cannot carry that - it relays Telegram's own protocol and nothing else - so when the console
// lists one, the same bot signs in over MTProto and everything goes through the proxy instead.
// The API host is still there underneath, as the last thing a message tries.
import type { TelegramProxy } from '../../contract/shared.ts';
import type { Fetch } from '../checkout/zarinpal.ts';

/** What the client needs, read fresh per call so the console can change it without a restart. */
export interface TelegramSettings {
    /** From @BotFather. Empty means Telegram is off, and everything here becomes a no-op. */
    botToken: string;

    /** Where messages go. A user id, a group id, or a channel like `@ashbringerops`. */
    chatId: string;

    /** The API host. A setting because a shop behind a filtered network may need a relay. */
    baseUrl: string;

    /**
     * MTProto proxies, attempted in order, and the my.telegram.org pair the bot signs in to
     * MTProto with. ALL OR NOTHING: without the pair the list is ignored.
     */
    apiId?: string;
    apiHash?: string;
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

    /** Tries ONE proxy, saved or not. It needs the api pair and nothing else - not the token. */
    testProxy(proxy: TelegramProxy): Promise<ProxyTest>;
}

/**
 * TELEGRAM said no to a sign-in - through a proxy that did its job.
 *
 * Kept apart from every other way opening a session can fail, because the response is the
 * opposite one. A dead proxy means try the next. A refused token, a wrong api id or a flood
 * wait means STOP: the next proxy would be told exactly the same thing, and each one asked is
 * another sign-in on the count Telegram is refusing the bot for.
 */
export class TelegramRefusal extends Error {
    /** How long Telegram said to stay away, when it said. Zero otherwise. */
    public readonly waitSeconds: number;

    constructor(reason: string, waitSeconds = 0) {
        super(reason);
        this.name = 'TelegramRefusal';
        this.waitSeconds = waitSeconds;
    }
}

/** A message sent TO the bot, as a proxied session reports it. */
export type MtprotoMessage = Omit<TelegramUpdate, 'updateId'>;

/**
 * The bot, signed in through one proxy.
 *
 * A SEND HAS TWO WAYS TO FAIL AND THEY ARE KEPT APART. It RESOLVES with whatever Telegram
 * said, yes or no - a refusal is an answer, and no other proxy would get a different one. It
 * REJECTS when the proxy stopped carrying it, which is the only case worth trying the next
 * proxy for.
 */
export interface MtprotoSession {
    sendMessage(chatId: string, text: string, signal: AbortSignal): Promise<TelegramResult>;

    sendDocument(
        chatId: string,
        filename: string,
        bytes: Uint8Array,
        caption: string,
        signal: AbortSignal
    ): Promise<TelegramResult>;

    /** Rejects when Telegram no longer answers through this proxy. */
    ping(signal: AbortSignal): Promise<void>;

    close(): void;
}

/**
 * The MTProto side, INJECTED for the reason `fetch` is. The real one (./mtproto.ts) opens
 * sockets and signs a bot in; a test hands over one that does neither.
 */
export interface Mtproto {
    /**
     * Signs the bot in through one proxy. Rejects when anything on the way fails, and with a
     * `TelegramRefusal` when what failed was Telegram refusing the sign-in itself.
     */
    open(
        login: { apiId: number; apiHash: string; botToken: string },
        proxy: TelegramProxy,
        onMessage: (message: MtprotoMessage) => void,
        signal: AbortSignal
    ): Promise<MtprotoSession>;

    /**
     * Reaches Telegram through one proxy WITHOUT signing in. Telegram counts sign-ins and
     * starts refusing a bot that makes too many, so a test button must not spend one.
     */
    probe(
        api: { apiId: number; apiHash: string },
        proxy: TelegramProxy,
        signal: AbortSignal
    ): Promise<void>;
}

export interface TelegramOptions {
    settings: () => TelegramSettings;
    fetch?: Fetch;

    /** Absent means the proxy list is never used - which is every test that does not set it. */
    mtproto?: Mtproto;

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

/** @internal The my.telegram.org pair, or null when either half is missing. */
function apiOf(live: TelegramSettings): { apiId: number; apiHash: string } | null {
    const apiId = Number(live.apiId ?? '');
    const apiHash = live.apiHash ?? '';
    return apiId > 0 && apiHash !== '' ? { apiId, apiHash } : null;
}

/** @internal Why something thrown failed, in words an operator can act on. */
function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : 'proxy unreachable';
}

/** After every proxy has failed, how long before any of them is tried again. */
const REDIAL_MS = 15_000;

/**
 * After Telegram refused the sign-in, how long before it is asked again. Long, because the
 * usual cause is a token or an api id that only the console can fix - and saving either there
 * ends the wait at once, since the wait belongs to the settings that were refused.
 */
const REFUSED_MS = 5 * 60_000;

/**
 * How many unread messages a proxied session may hold. Anybody can message a bot, so the
 * queue is bounded by this rather than by a stranger's patience.
 */
const INBOX_LIMIT = 100;

export function createTelegram(options: TelegramOptions): Telegram {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;
    const uploadTimeoutMs = options.uploadTimeoutMs ?? 120_000;
    const { mtproto } = options;

    /** The one proxied session, and the settings it was opened under. */
    let session: { key: string; link: MtprotoSession } | null = null;

    /** A sign-in in flight. There is never more than one - see `link`. */
    let opening: Promise<MtprotoSession | null> | null = null;

    /** The settings every proxy last failed under, and when to stop believing it. */
    let failed: { key: string; until: number } | null = null;

    /** Why the proxies last could not be used. Read out when the API host fails as well. */
    let trouble = '';

    /** What arrived through the proxy and has not been handed to `receive` yet. */
    const inbox: MtprotoMessage[] = [];
    let wake: (() => void) | null = null;

    /** True once commands have come by proxy: the Bot API's own queue is then old news. */
    let stale = false;

    /** The Bot API offset below which everything has been thrown away as old news. */
    let floor = 0;

    function proxied(live: TelegramSettings): boolean {
        return mtproto !== undefined && (live.proxies ?? []).length > 0 && apiOf(live) !== null;
    }

    function drop(): void {
        session?.link.close();
        session = null;
    }

    /** @internal Signs in through the first proxy that will carry it, in the order listed. */
    async function dial(
        via: Mtproto,
        login: { apiId: number; apiHash: string; botToken: string },
        proxies: TelegramProxy[],
        key: string
    ): Promise<MtprotoSession | null> {
        for (const proxy of proxies) {
            try {
                const opened = await via.open(
                    login,
                    proxy,
                    (message) => {
                        inbox.push(message);
                        if (inbox.length > INBOX_LIMIT) {
                            inbox.shift();
                        }
                        wake?.();
                    },
                    // Twice a message's budget: a sign-in is a key exchange and then a
                    // login, and a bot is often sent on to a second data centre to do both
                    // again.
                    AbortSignal.timeout(timeoutMs * 2)
                );
                session = { key, link: opened };
                return opened;
            } catch (error) {
                trouble = reasonOf(error);
                if (error instanceof TelegramRefusal) {
                    failed = {
                        key,
                        until: Date.now() + Math.max(REFUSED_MS, error.waitSeconds * 1000)
                    };
                    return null;
                }
                // Anything else is a dead proxy, which is the ordinary state of a proxy.
                // The next one is why there is a list.
            }
        }
        failed = { key, until: Date.now() + REDIAL_MS };
        return null;
    }

    /**
     * @internal The proxied session, opened if it has to be, or null when no proxy works.
     *
     * ONE SIGN-IN AT A TIME. A sale, a backup and the command loop can all want the session
     * in the same second, and three of them dialling at once is three sign-ins for one bot.
     *
     * AND NOT ON EVERY CALL. Once the whole list has failed it is left alone for a while, so
     * a buyer's request waiting on a notification pays for a dead list once, not every time.
     * Longer still when it was Telegram that refused - see `TelegramRefusal`.
     */
    async function link(live: TelegramSettings): Promise<MtprotoSession | null> {
        const api = apiOf(live);
        if (mtproto === undefined || api === null) {
            return null;
        }
        // `for (;;)` for the reason the command loop gives: `opening` is cleared from inside
        // the promise being awaited, where the loop-condition lint cannot see it.
        for (;;) {
            if (opening === null) {
                break;
            }
            await opening;
        }
        const key = JSON.stringify([live.botToken, live.apiId, live.apiHash, live.proxies]);
        if (session !== null && session.key !== key) {
            // The console changed something, and the session belongs to what it was before.
            drop();
        }
        if (session !== null) {
            return session.link;
        }
        if (failed !== null && failed.key === key && Date.now() < failed.until) {
            return null;
        }
        const attempt = dial(
            mtproto,
            { ...api, botToken: live.botToken },
            live.proxies ?? [],
            key
        ).finally(() => {
            opening = null;
        });
        opening = attempt;
        return attempt;
    }

    /**
     * @internal Sends through a proxy, or returns null when none would carry it.
     *
     * TWICE, NOT ONCE. A proxy that died since the last send costs one attempt to find out;
     * the second goes through whichever proxy the redial landed on.
     */
    async function carry(
        live: TelegramSettings,
        budget: number,
        act: (via: MtprotoSession, signal: AbortSignal) => Promise<TelegramResult>
    ): Promise<TelegramResult | null> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const via = await link(live);
            if (via === null) {
                return null;
            }
            try {
                return await act(via, AbortSignal.timeout(budget));
            } catch (error) {
                trouble = reasonOf(error);
                if (session?.link === via) {
                    drop();
                }
            }
        }
        return null;
    }

    /**
     * @internal One call, which never throws. Telegram answers a refusal with 200 and
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
        try {
            const response = await call(`${live.baseUrl}/bot${live.botToken}/${path}`, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(budget)
            });
            const answer = (await response.json()) as { ok?: boolean; description?: string };
            if (answer.ok === true) {
                return { ok: true };
            }
            return {
                ok: false,
                reason: answer.description ?? `telegram returned ${response.status}`
            };
        } catch {
            return { ok: false, reason: 'telegram unreachable' };
        }
    }

    /**
     * @internal Through a proxy when there is one to go through, and straight to the API host
     * when there is not - or when the proxied side did not deliver it, for whatever reason.
     *
     * EVEN A REFUSAL GETS THE SECOND WIRE. The two do not resolve a chat the same way, and a
     * sale notification that one of them could have delivered is worth the one extra request.
     * When both fail it is the proxied side's reason that is reported: it is the wire the
     * operator chose, and the one they can do something about.
     */
    async function deliver(
        budget: number,
        act: (via: MtprotoSession, signal: AbortSignal) => Promise<TelegramResult>,
        direct: () => Promise<TelegramResult>
    ): Promise<TelegramResult> {
        const live = options.settings();
        if (!ready(live) || !proxied(live)) {
            return direct();
        }
        const carried = await carry(live, budget, act);
        if (carried?.ok === true) {
            return carried;
        }
        const answer = await direct();
        if (answer.ok) {
            return answer;
        }
        return carried ?? { ok: false, reason: `${answer.reason} (proxies: ${trouble})` };
    }

    /** @internal One long-poll of the Bot API, or null when it could not be made. */
    async function poll(
        live: TelegramSettings,
        offset: number,
        seconds: number
    ): Promise<TelegramUpdate[] | null> {
        try {
            const response = await call(`${live.baseUrl}/bot${live.botToken}/getUpdates`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    offset,
                    timeout: seconds,
                    // Only messages. Without this the bot is also handed edits, reactions
                    // and join events, every one of which would have to be skipped here.
                    allowed_updates: ['message']
                }),
                // The HTTP request is held open for the whole poll, so the budget has to
                // outlast it. A timeout equal to the poll would abort every quiet cycle.
                signal: AbortSignal.timeout(seconds * 1000 + timeoutMs)
            });
            const answer = (await response.json()) as { ok?: boolean; result?: unknown };
            if (answer.ok !== true || !Array.isArray(answer.result)) {
                return null;
            }
            return (answer.result as RawUpdate[]).flatMap(readUpdate);
        } catch {
            return null;
        }
    }

    return {
        configured: () => ready(options.settings()),

        sendMessage(text: string): Promise<TelegramResult> {
            const { chatId } = options.settings();
            return deliver(
                timeoutMs,
                (via, signal) => via.sendMessage(chatId, text, signal),
                () =>
                    send(
                        'sendMessage',
                        JSON.stringify({
                            chat_id: chatId,
                            text,
                            // No parse mode. Telegram's Markdown and HTML modes both REJECT the
                            // whole message when a stray character in interpolated data looks
                            // like markup, and the data here includes a mobile number someone
                            // else chose. A notification that silently fails to arrive is worse
                            // than a plain one.
                            disable_web_page_preview: true
                        }),
                        { 'content-type': 'application/json' },
                        timeoutMs
                    )
            );
        },

        sendDocument(filename, bytes, caption): Promise<TelegramResult> {
            const { chatId } = options.settings();
            return deliver(
                uploadTimeoutMs,
                (via, signal) => via.sendDocument(chatId, filename, bytes, caption, signal),
                () => {
                    const form = new FormData();
                    form.set('chat_id', chatId);
                    form.set('caption', caption);
                    // The filename matters: Telegram shows it, and it is what the operator will
                    // be looking at in a list of hourly backups when they need one.
                    form.set('document', new Blob([bytes as BlobPart]), filename);

                    // No content-type header: fetch sets it, WITH the multipart boundary.
                    // Setting it by hand omits the boundary and the upload is rejected as
                    // malformed.
                    return send('sendDocument', form, {}, uploadTimeoutMs);
                }
            );
        },

        async receive(offset, seconds): Promise<TelegramUpdate[]> {
            const live = options.settings();
            if (!ready(live)) {
                return [];
            }

            // ONE BELOW THE CALLER'S OFFSET, so the offset does not move. It is the Bot
            // API's cursor and these messages were never in the Bot API's queue: they are
            // handed over once and are gone from the inbox, which is all the acknowledging a
            // proxied message gets.
            const handOver = (): TelegramUpdate[] =>
                inbox.splice(0).map((message) => ({
                    updateId: offset - 1,
                    chatId: message.chatId,
                    chatUsername: message.chatUsername,
                    text: message.text
                }));

            // Whatever already came by proxy goes first, whichever wire is in use now: a
            // command must never be overtaken by one sent after it.
            if (inbox.length > 0) {
                return handOver();
            }

            const via = proxied(live) ? await link(live) : null;
            if (via !== null) {
                stale = true;
                try {
                    // A proxy dies without saying so, and a session waiting on a dead one
                    // waits for ever. Asked once a cycle, which is as often as the Bot API
                    // side makes a request of its own.
                    await via.ping(AbortSignal.timeout(timeoutMs));
                } catch (error) {
                    trouble = reasonOf(error);
                    if (session?.link === via) {
                        drop();
                    }
                    return [];
                }
                if (inbox.length === 0) {
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, seconds * 1000);
                        // A quiet poll must not be the reason a shutting-down process lingers.
                        timer.unref();
                        wake = (): void => {
                            clearTimeout(timer);
                            resolve();
                        };
                    });
                    wake = null;
                }
                return handOver();
            }

            // No proxy, or none that works: the API host is the last resort for commands
            // exactly as it is for messages.
            if (stale) {
                // THE BOT API KEPT ITS OWN COPY of everything that came by proxy, and hands
                // it all over the moment it is asked. Without this, the first poll after the
                // proxies stop being used would run every command of the last day a second
                // time - and one of those is /setprice. `-1` asks for the newest update alone
                // and forgets the rest.
                const newest = await poll(live, -1, 0);
                if (newest === null) {
                    return [];
                }
                floor = Math.max(floor, ...newest.map((update) => update.updateId + 1));
                stale = false;
            }

            // A timeout, a dropped connection, a body that is not JSON: all the same thing
            // to the loop upstairs - nothing arrived this cycle.
            return (await poll(live, Math.max(offset, floor), seconds)) ?? [];
        },

        async testProxy(proxy): Promise<ProxyTest> {
            const api = apiOf(options.settings());
            if (mtproto === undefined || api === null) {
                return { ok: false, reason: 'api id and api hash are not set', ms: 0 };
            }
            const startedAt = Date.now();
            try {
                await mtproto.probe(api, proxy, AbortSignal.timeout(timeoutMs));
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
