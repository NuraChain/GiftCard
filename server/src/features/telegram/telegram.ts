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
// `fetch` is INJECTED the same way the gateway, the mailer and the rate sources take it: it is
// what lets every path here be tested without a network or a bot token.
import type { Fetch } from '../checkout/zarinpal.ts';

/** What the client needs, read fresh per call so the console can change it without a restart. */
export interface TelegramSettings {
    /** From @BotFather. Empty means Telegram is off, and everything here becomes a no-op. */
    botToken: string;

    /** Where messages go. A user id, a group id, or a channel like `@guardianops`. */
    chatId: string;

    /** The API host. A setting because a shop behind a filtered network may need a relay. */
    baseUrl: string;
}

export type TelegramResult = { ok: true } | { ok: false; reason: string };

/** What the app depends on - two methods, so a test can hand it a spy. */
export interface Telegram {
    /** True when a token and a chat are configured. Nothing is attempted otherwise. */
    configured(): boolean;

    sendMessage(text: string): Promise<TelegramResult>;

    sendDocument(filename: string, bytes: Uint8Array, caption: string): Promise<TelegramResult>;
}

export interface TelegramOptions {
    settings: () => TelegramSettings;
    fetch?: Fetch;

    /** A backup upload is slower than a message, so the two get different budgets. */
    timeoutMs?: number;
    uploadTimeoutMs?: number;
}

function ready(live: TelegramSettings): boolean {
    return live.botToken !== '' && live.chatId !== '';
}

export function createTelegram(options: TelegramOptions): Telegram {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;
    const uploadTimeoutMs = options.uploadTimeoutMs ?? 120_000;

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
                    // and the data here includes an email address someone else chose. A
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
        }
    };
}
