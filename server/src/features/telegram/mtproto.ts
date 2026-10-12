// The bot over MTProto, and the only file that knows which library speaks it.
//
// WHY THIS EXISTS AT ALL. Everything else the bot does is an HTTPS request to the Bot API, and
// an MTProto proxy does not carry HTTPS - it relays Telegram's own protocol and nothing else.
// A bot that wants to go through one has to speak that protocol itself. So this signs in with
// the same token, as the same bot, over a different wire.
//
// WHAT A PROXY SEES is traffic it cannot read. The token is used to sign in to TELEGRAM,
// encrypted end to end; the proxy is handed bytes. That is the whole difference from an HTTP
// relay, which has to be given the token in the URL to do its job.
//
// NOTHING IS KEPT ON DISK. A saved session would be a second copy of the bot's credential,
// and one that has to be thrown away the moment the token is changed in the console. The
// price is a sign-in per boot, and Telegram counts those - which is why ./telegram.ts opens one
// session and keeps it, and why `probe` below never signs in at all.
import {
    InputMedia,
    MemoryStorage,
    MtPeerNotFoundError,
    MtProxyTcpTransport,
    TelegramClient,
    tl
} from '@mtcute/node';

import type { TelegramProxy } from '../../contract/shared.ts';
import { TelegramRefusal, type Mtproto, type TelegramResult } from './telegram.ts';

function connect(
    api: { apiId: number; apiHash: string },
    proxy: TelegramProxy,
    updates: boolean
): TelegramClient {
    return new TelegramClient({
        apiId: api.apiId,
        apiHash: api.apiHash,
        storage: new MemoryStorage(),
        // The library's exit hook RE-RAISES SIGINT and SIGTERM once it has run, which would end
        // the process before main.ts has drained the requests in flight - and a settle
        // mid-flight is money. There is nothing on disk here to finalise, so it is off.
        storageOptions: { cleanup: false },
        transport: new MtProxyTcpTransport({
            host: proxy.server,
            port: proxy.port,
            secret: proxy.secret
        }),
        disableUpdates: !updates,
        // It logs to the console, and this process logs to a file. Failures come back as
        // reasons instead.
        logLevel: 0
    });
}

/**
 * @internal `work`, unless `signal` fires first. The library puts no deadline of its own on a
 * call, and one made through a dead proxy would otherwise wait for a reconnect that never comes.
 */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
        work.then(resolve, reject);
    });
}

/**
 * @internal `work`, unless the proxy fails it or `signal` fires first.
 *
 * Left alone, the library answers a refused connection by trying again, for ever. That is
 * right for a session already in use and wrong for a first attempt: there the first error IS
 * the answer, it arrives in milliseconds rather than at the deadline, and it says what was
 * wrong - which is the line the console shows beside a proxy that failed its test.
 */
function firstAttempt<T>(
    client: TelegramClient,
    work: Promise<T>,
    signal: AbortSignal
): Promise<T> {
    return new Promise((resolve, reject) => {
        client.onError.once(reject);
        within(work, signal).then(resolve, reject);
    });
}

/**
 * @internal What Telegram made of a send. A refusal RESOLVES - it is an answer, and the same
 * one any other proxy would get. Everything else is the wire, and is thrown for the caller to
 * try the next proxy with.
 */
async function answered(work: Promise<unknown>, signal: AbortSignal): Promise<TelegramResult> {
    try {
        await within(work, signal);
        return { ok: true };
    } catch (error) {
        if (tl.RpcError.is(error)) {
            return { ok: false, reason: error.text };
        }
        if (error instanceof MtPeerNotFoundError) {
            return { ok: false, reason: 'chat not found' };
        }
        throw error;
    }
}

/**
 * @internal The configured chat, as the library wants it: a number for an id, the name for a
 * channel. Handed the digits as a string it would go looking for a username spelled that way.
 */
function peer(chatId: string): number | string {
    return /^-?\d+$/.test(chatId) ? Number(chatId) : chatId;
}

export const mtproto: Mtproto = {
    async open(login, proxy, onMessage, signal) {
        const client = connect(login, proxy, true);
        try {
            await firstAttempt(client, client.start({ botToken: login.botToken }), signal);
        } catch (error) {
            void client.destroy().catch(() => {});
            // An answer from Telegram means the proxy worked and the sign-in did not. That
            // is not a reason to try another proxy - see `TelegramRefusal`.
            if (tl.RpcError.is(error)) {
                throw new TelegramRefusal(
                    error.text,
                    tl.RpcError.is(error, 'FLOOD_WAIT_%d') ? error.seconds : 0
                );
            }
            throw error;
        }

        client.onNewMessage.add((message) => {
            // What the Bot API side gets by asking for `message` updates only: text somebody
            // sent to the bot. Not its own messages, not a channel's posts, and not the
            // service lines a group produces whenever anyone joins or pins something.
            if (message.isOutgoing || message.isChannelPost || message.text === '') {
                return;
            }
            const { chat } = message;
            onMessage({
                chatId: String(chat.id),
                chatUsername: chat.username === null ? '' : `@${chat.username}`,
                text: message.text
            });
        });

        return {
            sendMessage: (chatId, text, limit) =>
                answered(client.sendText(peer(chatId), text, { disableWebPreview: true }), limit),

            sendDocument: (chatId, filename, bytes, caption, limit) =>
                answered(
                    client.sendMedia(
                        peer(chatId),
                        InputMedia.document(bytes, { fileName: filename, caption })
                    ),
                    limit
                ),

            ping: async (limit) => {
                await within(client.call({ _: 'help.getNearestDc' }), limit);
            },

            close: () => {
                void client.destroy().catch(() => {});
            }
        };
    },

    async probe(api, proxy, signal) {
        const client = connect(api, proxy, false);
        try {
            // Any answer at all proves the three things a proxy can get wrong: it is up, the
            // secret is the right one, and it really does reach Telegram behind it.
            await firstAttempt(client, client.call({ _: 'help.getNearestDc' }), signal);
        } finally {
            void client.destroy().catch(() => {});
        }
    }
};
