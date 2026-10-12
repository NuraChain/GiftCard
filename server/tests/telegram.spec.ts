// The operations bot: what it sends, what it refuses to send, and what it cleans up.
//
// The backup half is tested against a REAL SQLite database rather than a stub, because the
// thing most worth proving is that the snapshot it produces is a database somebody could
// actually restore - and a fake store would prove nothing about that at all.
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { createStore } from '../src/db/index.ts';
import { createBackupJob, createSaleNotifier, type Sale } from '../src/features/telegram/notify.ts';
import {
    createTelegram,
    TelegramRefusal,
    type Mtproto,
    type MtprotoMessage,
    type Telegram
} from '../src/features/telegram/telegram.ts';
import { parseProxyLink } from '../src/contract/shared.ts';
import { DEFAULT_BACKUP_MINUTES, MIN_BACKUP_MINUTES } from '../src/features/settings/contract.ts';

const SETTINGS = {
    botToken: '1234:TOKEN',
    chatId: '-100999',
    baseUrl: 'https://telegram.test'
};

const SALE: Sale = {
    amount: 10,
    toman: 1_309_000,
    phone: '+989121234567',
    refId: 987654,
    receipt: 'r1',
    remaining: 3,
    codeDelivered: true
};

/** A fetch that records what it was asked to do and answers however the test wants. */
function recorder(answer: unknown = { ok: true }, status = 200) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return Promise.resolve(
            new Response(JSON.stringify(answer), {
                status,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    return { calls, fetch: fake };
}

const PROXY_ONE = {
    server: 'one.proxy.test',
    port: 443,
    secret: '00112233445566778899aabbccddeeff'
};
const PROXY_TWO = {
    server: 'two.proxy.test',
    port: 8443,
    secret: '00112233445566778899aabbccddeeff'
};

/** The same bot, with the three things that send it through the proxies instead. */
const PROXIED = {
    ...SETTINGS,
    apiId: '123456',
    apiHash: 'feedfacefeedfacefeedfacefeedcafe',
    proxies: [PROXY_ONE, PROXY_TWO]
};

/**
 * An MTProto side that never opens a socket. A server named in `dead` refuses to connect and
 * stops answering if it already had; `refusal` is Telegram itself saying no.
 */
function fakeMtproto() {
    const state = {
        dead: new Set<string>(),
        refusal: '',
        /** Telegram refusing the SIGN-IN, through a proxy that is working perfectly well. */
        signInRefusal: null as TelegramRefusal | null,
        dialled: [] as string[],
        opened: [] as string[],
        closed: [] as string[],
        probed: [] as string[],
        sent: [] as Array<{ via: string; chatId: string; text: string }>,
        documents: [] as Array<{ via: string; filename: string; caption: string }>,
        /** Delivers a message to the bot through whichever session opened last. */
        say: (_message: MtprotoMessage): void => {}
    };
    const mtproto: Mtproto = {
        open: (_login, proxy, onMessage) => {
            state.dialled.push(proxy.server);
            if (state.dead.has(proxy.server)) {
                return Promise.reject(new Error('proxy refused'));
            }
            if (state.signInRefusal !== null) {
                return Promise.reject(state.signInRefusal);
            }
            state.opened.push(proxy.server);
            state.say = onMessage;
            const alive = (): Promise<void> =>
                state.dead.has(proxy.server)
                    ? Promise.reject(new Error('connection lost'))
                    : Promise.resolve();
            return Promise.resolve({
                sendMessage: async (chatId, text) => {
                    await alive();
                    if (state.refusal !== '') {
                        return { ok: false, reason: state.refusal };
                    }
                    state.sent.push({ via: proxy.server, chatId, text });
                    return { ok: true };
                },
                sendDocument: async (_chatId, filename, _bytes, caption) => {
                    await alive();
                    state.documents.push({ via: proxy.server, filename, caption });
                    return { ok: true };
                },
                ping: alive,
                close: () => {
                    state.closed.push(proxy.server);
                }
            });
        },
        probe: (_api, proxy) => {
            state.probed.push(proxy.server);
            return state.dead.has(proxy.server)
                ? Promise.reject(new Error('proxy refused'))
                : Promise.resolve();
        }
    };
    return { state, mtproto };
}

/** A telegram that records messages and is always configured. */
function spyBot(): Telegram & { sent: string[] } {
    const sent: string[] = [];
    return {
        sent,
        configured: () => true,
        receive: () => Promise.resolve([]),
        sendMessage: (text) => {
            sent.push(text);
            return Promise.resolve({ ok: true });
        },
        sendDocument: () => Promise.resolve({ ok: true }),
        testProxy: () => Promise.resolve({ ok: true, reason: '', ms: 0 })
    };
}

function scratch(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'ashbringer-backup-test-'));
}

describe('the telegram client', () => {
    it('posts a message to the configured chat', async () => {
        const spy = recorder();
        const telegram = createTelegram({ settings: () => SETTINGS, fetch: spy.fetch });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(spy.calls[0].url).toBe('https://telegram.test/bot1234:TOKEN/sendMessage');

        const body = JSON.parse(String(spy.calls[0].init?.body)) as {
            chat_id: string;
            text: string;
        };
        expect(body.chat_id).toBe('-100999');
        expect(body.text).toBe('hello');
    });

    it('does nothing at all when it is not configured', async () => {
        const spy = recorder();
        const telegram = createTelegram({
            settings: () => ({ ...SETTINGS, botToken: '' }),
            fetch: spy.fetch
        });

        expect(telegram.configured()).toBe(false);
        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'telegram is not configured'
        });
        // Not merely "returns a failure" - it must not have gone near the network.
        expect(spy.calls).toHaveLength(0);
    });

    it('reads the refusal out of the BODY, not the status', async () => {
        // Telegram answers a bad token with 200 and ok:false as readily as with a 4xx, so a
        // status check alone would report success on a bot that does not exist.
        const spy = recorder({ ok: false, description: 'Unauthorized' }, 200);
        const telegram = createTelegram({ settings: () => SETTINGS, fetch: spy.fetch });

        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'Unauthorized'
        });
    });

    it('survives a network that is simply not there', async () => {
        const telegram = createTelegram({
            settings: () => SETTINGS,
            fetch: () => Promise.reject(new Error('ECONNREFUSED'))
        });
        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'telegram unreachable'
        });
    });

    it('uploads a document as multipart without setting the boundary by hand', async () => {
        const spy = recorder();
        const telegram = createTelegram({ settings: () => SETTINGS, fetch: spy.fetch });

        await telegram.sendDocument('backup.db', new Uint8Array([1, 2, 3]), 'caption');

        expect(spy.calls[0].url).toBe('https://telegram.test/bot1234:TOKEN/sendDocument');
        expect(spy.calls[0].init?.body).toBeInstanceOf(FormData);
        // Setting content-type by hand omits the multipart boundary and the upload is
        // rejected as malformed. Leaving it out is what lets fetch fill it in.
        expect(spy.calls[0].init?.headers).toEqual({});
    });
});

describe('the telegram client, through MTProto proxies', () => {
    it('signs in through the first proxy that works and leaves the API host alone', async () => {
        const spy = recorder();
        const fake = fakeMtproto();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(fake.state.opened).toEqual([PROXY_TWO.server]);
        expect(fake.state.sent).toEqual([
            { via: PROXY_TWO.server, chatId: '-100999', text: 'hello' }
        ]);
        expect(spy.calls).toHaveLength(0);
    });

    it('signs in once, however many messages want the session at the same moment', async () => {
        // Telegram counts sign-ins and starts refusing a bot that makes too many, so three
        // sales in the same second must not be three of them.
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });

        await Promise.all([
            telegram.sendMessage('one'),
            telegram.sendMessage('two'),
            telegram.sendDocument('backup.zip', new Uint8Array([1, 2, 3]), 'caption')
        ]);
        await telegram.sendMessage('three');

        expect(fake.state.opened).toEqual([PROXY_ONE.server]);
        expect(fake.state.sent).toHaveLength(3);
        expect(fake.state.documents).toEqual([
            { via: PROXY_ONE.server, filename: 'backup.zip', caption: 'caption' }
        ]);
    });

    it('moves to the next proxy when the one in use dies', async () => {
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });
        await telegram.sendMessage('before');

        fake.state.dead.add(PROXY_ONE.server);

        expect(await telegram.sendMessage('after')).toEqual({ ok: true });
        expect(fake.state.closed).toEqual([PROXY_ONE.server]);
        expect(fake.state.sent.map((message) => message.via)).toEqual([
            PROXY_ONE.server,
            PROXY_TWO.server
        ]);
    });

    it('falls back to the API host when no proxy will carry the message', async () => {
        const spy = recorder();
        const fake = fakeMtproto();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(spy.calls.map((call) => call.url)).toEqual([
            'https://telegram.test/bot1234:TOKEN/sendMessage'
        ]);

        // And the dead list is left alone for a while rather than dialled again per message.
        await telegram.sendMessage('again');
        expect(fake.state.opened).toEqual([]);
        expect(spy.calls).toHaveLength(2);
    });

    it('says why the proxies failed when the API host fails too', async () => {
        const fake = fakeMtproto();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'telegram unreachable (proxies: proxy refused)'
        });
    });

    it('gives the API host a turn when Telegram refuses through the proxy', async () => {
        // The two wires do not resolve a chat the same way, so a "no" from one is not yet a
        // "no" from Telegram. The session is kept: the proxy did nothing wrong.
        const spy = recorder();
        const fake = fakeMtproto();
        fake.state.refusal = 'CHAT_WRITE_FORBIDDEN';
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(spy.calls).toHaveLength(1);
        expect(fake.state.closed).toEqual([]);
    });

    it('reports what the proxied side said when both wires refuse', async () => {
        const fake = fakeMtproto();
        fake.state.refusal = 'CHAT_WRITE_FORBIDDEN';
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'CHAT_WRITE_FORBIDDEN'
        });
    });

    it('stops at the first proxy when it is Telegram that refuses the sign-in', async () => {
        // A mistyped token gets the same answer through every proxy, and each one asked is
        // another sign-in on the count Telegram refuses a bot for. One, then leave it alone.
        const spy = recorder();
        const fake = fakeMtproto();
        fake.state.signInRefusal = new TelegramRefusal('ACCESS_TOKEN_INVALID');
        let live = PROXIED;
        const telegram = createTelegram({
            settings: () => live,
            fetch: spy.fetch,
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        await telegram.sendMessage('again');
        await telegram.receive(0, 0);

        expect(fake.state.dialled).toEqual([PROXY_ONE.server]);
        expect(spy.calls).toHaveLength(3);

        // Fixing the token in the console ends the wait at once: the wait belonged to the
        // settings that were refused.
        fake.state.signInRefusal = null;
        live = { ...PROXIED, botToken: '1234:RIGHT' };
        await telegram.sendMessage('fixed');

        expect(fake.state.opened).toEqual([PROXY_ONE.server]);
        expect(fake.state.sent.map((message) => message.text)).toEqual(['fixed']);
    });

    it('ignores the list until the api id and hash are both set', async () => {
        const spy = recorder();
        const fake = fakeMtproto();
        const telegram = createTelegram({
            settings: () => ({ ...PROXIED, apiHash: '' }),
            fetch: spy.fetch,
            mtproto: fake.mtproto
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(fake.state.opened).toEqual([]);
        expect(spy.calls).toHaveLength(1);
    });

    it('opens a new session when the console changes the list', async () => {
        const fake = fakeMtproto();
        let live = PROXIED;
        const telegram = createTelegram({ settings: () => live, mtproto: fake.mtproto });
        await telegram.sendMessage('before');

        live = { ...PROXIED, proxies: [PROXY_TWO] };
        await telegram.sendMessage('after');

        expect(fake.state.closed).toEqual([PROXY_ONE.server]);
        expect(fake.state.opened).toEqual([PROXY_ONE.server, PROXY_TWO.server]);
    });

    it('hands over what arrives through the proxy without moving the offset', async () => {
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });

        const waiting = telegram.receive(7, 30);
        await vi.waitFor(() => expect(fake.state.opened).toHaveLength(1));
        fake.state.say({ chatId: '-100999', chatUsername: '', text: '/status' });

        // One BELOW the offset it was asked with: that number is the Bot API's cursor, and a
        // message that was never in the Bot API's queue has no business advancing it.
        expect(await waiting).toEqual([
            { updateId: 6, chatId: '-100999', chatUsername: '', text: '/status' }
        ]);
    });

    it('polls the API host for commands when no proxy works', async () => {
        const fake = fakeMtproto();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const offsets: number[] = [];
        const telegram = createTelegram({
            settings: () => PROXIED,
            mtproto: fake.mtproto,
            fetch: (_url, init) => {
                offsets.push((JSON.parse(String(init?.body)) as { offset: number }).offset);
                const result = [
                    { update_id: 41, message: { text: '/status', chat: { id: -100999 } } }
                ];
                return Promise.resolve(new Response(JSON.stringify({ ok: true, result })));
            }
        });

        expect(await telegram.receive(41, 0)).toEqual([
            { updateId: 41, chatId: '-100999', chatUsername: '', text: '/status' }
        ]);
        // Nothing came by proxy, so there is no backlog to throw away - and the command that
        // was waiting in the Bot API's queue is the one the operator wants run.
        expect(offsets).toEqual([41]);
    });

    it('drops a session whose proxy has stopped answering, so the next poll redials', async () => {
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });
        await telegram.sendMessage('before');

        fake.state.dead.add(PROXY_ONE.server);

        expect(await telegram.receive(0, 30)).toEqual([]);
        expect(fake.state.closed).toEqual([PROXY_ONE.server]);
    });

    it('throws the Bot API backlog away once the proxies are removed', async () => {
        // The Bot API keeps its own copy of everything the proxied session already answered.
        // Read as usual, the first poll after the list is emptied would run a whole day of
        // commands a second time - and one of them is /setprice.
        const fake = fakeMtproto();
        const offsets: number[] = [];
        let live: typeof SETTINGS = PROXIED;
        const telegram = createTelegram({
            settings: () => live,
            mtproto: fake.mtproto,
            fetch: (_url, init) => {
                const { offset } = JSON.parse(String(init?.body)) as { offset: number };
                offsets.push(offset);
                const result =
                    offset === -1
                        ? [
                              {
                                  update_id: 500,
                                  message: { text: '/setprice 1', chat: { id: -100999 } }
                              }
                          ]
                        : [];
                return Promise.resolve(new Response(JSON.stringify({ ok: true, result })));
            }
        });

        const waiting = telegram.receive(0, 30);
        await vi.waitFor(() => expect(fake.state.opened).toHaveLength(1));
        fake.state.say({ chatId: '-100999', chatUsername: '', text: '/setprice 245000' });
        await waiting;

        live = SETTINGS;

        expect(await telegram.receive(0, 0)).toEqual([]);
        expect(offsets).toEqual([-1, 501]);
    });

    it('tries one proxy without signing the bot in', async () => {
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });

        const result = await telegram.testProxy(PROXY_TWO);

        expect(result.ok).toBe(true);
        expect(fake.state.probed).toEqual([PROXY_TWO.server]);
        expect(fake.state.opened).toEqual([]);
    });

    it('says why a proxy failed its test', async () => {
        const fake = fakeMtproto();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({ settings: () => PROXIED, mtproto: fake.mtproto });

        expect(await telegram.testProxy(PROXY_ONE)).toMatchObject({
            ok: false,
            reason: 'proxy refused'
        });
    });

    it('will not test a proxy before the api id and hash are set', async () => {
        const fake = fakeMtproto();
        const telegram = createTelegram({ settings: () => SETTINGS, mtproto: fake.mtproto });

        expect(await telegram.testProxy(PROXY_ONE)).toEqual({
            ok: false,
            reason: 'api id and api hash are not set',
            ms: 0
        });
        expect(fake.state.probed).toEqual([]);
    });
});

describe('a proxy link', () => {
    it('reads the link Telegram shares, in both of its spellings', () => {
        const secret = 'ee00112233445566778899aabbccddeeff676f6f676c652e636f6d';

        expect(parseProxyLink(`tg://proxy?server=1.2.3.4&port=443&secret=${secret}`)).toEqual({
            server: '1.2.3.4',
            port: 443,
            secret
        });
        expect(
            parseProxyLink(
                '  https://t.me/proxy?server=mt.example.com&port=8443&secret=3dpBFlW2hP6Hq_WOwiNeKBY '
            )
        ).toEqual({ server: 'mt.example.com', port: 8443, secret: '3dpBFlW2hP6Hq_WOwiNeKBY' });
    });

    it('reads nothing out of anything else', () => {
        const secret = '00112233445566778899aabbccddeeff';

        // Another kind of proxy, a link to somewhere else, and a secret that lost two characters.
        expect(parseProxyLink(`tg://socks?server=1.2.3.4&port=1080`)).toBeNull();
        expect(
            parseProxyLink(`https://example.com/proxy?server=a&port=1&secret=${secret}`)
        ).toBeNull();
        expect(
            parseProxyLink(`tg://proxy?server=1.2.3.4&port=443&secret=${secret.slice(2)}`)
        ).toBeNull();
        expect(parseProxyLink(`tg://proxy?server=1.2.3.4&port=99999&secret=${secret}`)).toBeNull();
        expect(parseProxyLink('1.2.3.4:443')).toBeNull();
    });
});

describe('the sale notification', () => {
    it('says what sold, for how much, and to whom', () => {
        const bot = spyBot();
        createSaleNotifier({ telegram: bot, appName: () => 'اشبرینگر' }).sold(SALE);

        expect(bot.sent).toHaveLength(1);
        expect(bot.sent[0]).toContain('10');
        expect(bot.sent[0]).toContain('1,309,000');
        expect(bot.sent[0]).toContain('+989121234567');
        expect(bot.sent[0]).toContain('987654');
    });

    it('shouts about a sale with no code to give', () => {
        const bot = spyBot();
        createSaleNotifier({ telegram: bot, appName: () => 'x' }).sold({
            ...SALE,
            codeDelivered: false
        });

        // Money taken and nothing delivered is the one case that needs a person, so it must
        // not read like an ordinary sale.
        expect(bot.sent[0]).toContain('هشدار');
    });

    it('stays quiet when the bot is not configured', () => {
        const bot = spyBot();
        const quiet = { ...bot, configured: (): boolean => false };
        createSaleNotifier({ telegram: quiet, appName: () => 'x' }).sold(SALE);
        expect(bot.sent).toHaveLength(0);
    });
});

describe('the scheduled backup', () => {
    it('sends a ZIP whose contents are a restorable database, then deletes it', async () => {
        const dir = await scratch();
        const store = createStore(':memory:');
        store.addCodes(10, [crypto.randomUUID()]);

        let uploaded: Uint8Array | null = null;
        let uploadedName = '';
        const bot: Telegram = {
            configured: () => true,
            receive: () => Promise.resolve([]),
            sendMessage: () => Promise.resolve({ ok: true }),
            sendDocument: (name, bytes) => {
                uploadedName = name;
                uploaded = bytes;
                return Promise.resolve({ ok: true });
            },
            testProxy: () => Promise.resolve({ ok: true, reason: '', ms: 0 })
        };

        const result = await createBackupJob({
            store,
            telegram: bot,
            appName: () => 'اشبرینگر',
            everyMinutes: () => DEFAULT_BACKUP_MINUTES,
            scratchDir: dir
        }).runNow();

        expect(result).toEqual({ ok: true });
        expect(uploaded).not.toBeNull();

        // The chat shows a .zip; the file an operator extracts from it is a .db, so SQLite
        // opens it by its own extension without anybody renaming anything.
        expect(uploadedName).toMatch(/^ashbringer-.+\.zip$/);

        // THE CLAIM WORTH MAKING: what was uploaded UNZIPS to a database with the row in it.
        // A backup that cannot be restored is not a backup, and now there is a container
        // between the upload and the database that could get that wrong.
        const archive = Buffer.from(uploaded as unknown as Uint8Array);
        const nameLength = archive.readUInt16LE(26);
        const entryName = archive.subarray(30, 30 + nameLength).toString('utf8');
        expect(entryName).toMatch(/^ashbringer-.+\.db$/);

        const start = 30 + nameLength + archive.readUInt16LE(28);
        const payload = archive.subarray(start, start + archive.readUInt32LE(18));
        const snapshot = archive.readUInt16LE(8) === 8 ? inflateRawSync(payload) : payload;

        const restoredPath = join(dir, 'restored.db');
        await writeFile(restoredPath, snapshot);
        const restored = new DatabaseSync(restoredPath);
        const count = restored.prepare('SELECT COUNT(*) AS n FROM codes').get() as { n: number };
        expect(count.n).toBe(1);
        restored.close();

        // The snapshot is a complete copy of the business sitting in a temp directory. Only
        // the file this test wrote itself should remain.
        expect(await readdir(dir)).toEqual(['restored.db']);

        store.close();
        await rm(dir, { recursive: true, force: true });
    });

    it('refuses rather than pretending when there is no bot', async () => {
        const dir = await scratch();
        const store = createStore(':memory:');
        const bot: Telegram = {
            configured: () => false,
            receive: () => Promise.resolve([]),
            sendMessage: () => Promise.resolve({ ok: true }),
            sendDocument: () => Promise.resolve({ ok: true }),
            testProxy: () => Promise.resolve({ ok: true, reason: '', ms: 0 })
        };

        expect(
            await createBackupJob({
                store,
                telegram: bot,
                appName: () => 'x',
                everyMinutes: () => DEFAULT_BACKUP_MINUTES,
                scratchDir: dir
            }).runNow()
        ).toEqual({ ok: false, reason: 'telegram is not configured' });

        // Nothing was written, so there is nothing to leak.
        expect(await readdir(dir)).toEqual([]);

        store.close();
        await rm(dir, { recursive: true, force: true });
    });
});

/**
 * A bot that is switched off, and counts how often it was asked.
 *
 * THE QUESTION IS THE MEASUREMENT. `configured()` is the first thing a backup does and the only
 * part of it that is synchronous; an unconfigured bot turns the whole job into a no-op that
 * reads no file and compresses nothing, so a fake clock can drive a day of ticks through it and
 * count the decisions exactly. What a CONFIGURED backup actually produces is proved against a
 * real database and a real clock in `the scheduled backup` - these are about WHEN it runs, and
 * a fake clock cannot advance the threadpool the real one uses.
 */
function askCounter(): Telegram & { asked: number } {
    const bot: Telegram & { asked: number } = {
        asked: 0,
        configured: () => {
            bot.asked += 1;
            return false;
        },
        receive: () => Promise.resolve([]),
        sendMessage: () => Promise.resolve({ ok: true }),
        sendDocument: () => Promise.resolve({ ok: true }),
        testProxy: () => Promise.resolve({ ok: true, reason: '', ms: 0 })
    };
    return bot;
}

/** A started schedule over a throwaway database. The returned function stops and closes both. */
function scheduled(bot: Telegram, everyMinutes: () => number): () => void {
    const store = createStore(':memory:');
    const stop = createBackupJob({
        store,
        telegram: bot,
        appName: () => 'x',
        everyMinutes
    }).start();
    return (): void => {
        stop();
        store.close();
    };
}

describe('the backup schedule', () => {
    it('waits out the configured gap before the first backup, and not longer', async () => {
        vi.useFakeTimers();
        const bot = askCounter();
        const stop = scheduled(bot, () => 10);

        try {
            // Nothing on boot. A process that restarts often would otherwise copy the whole
            // database on every restart, which is the opposite of a safeguard.
            await vi.advanceTimersByTimeAsync(9 * 60_000);
            expect(bot.asked).toBe(0);

            await vi.advanceTimersByTimeAsync(60_000);
            expect(bot.asked).toBe(1);

            // And again on the same cadence, rather than once and then never.
            await vi.advanceTimersByTimeAsync(10 * 60_000);
            expect(bot.asked).toBe(2);
        } finally {
            stop();
            vi.useRealTimers();
        }
    });

    it('honours an interval shortened in the console without waiting out the old one', async () => {
        vi.useFakeTimers();
        const bot = askCounter();

        // THE REGRESSION THIS TEST EXISTS TO CATCH. `setInterval(backup, gap)` fixes the gap at
        // the moment it is armed, so an operator who cut a daily backup to a ten-minute one
        // after a scare would get the first short gap A DAY LATER - on the one day it mattered.
        let minutes = 24 * 60;
        const stop = scheduled(bot, () => minutes);

        try {
            await vi.advanceTimersByTimeAsync(30 * 60_000);
            expect(bot.asked).toBe(0);

            // Half an hour is already past the new gap, so the next tick is due at once.
            minutes = 10;
            await vi.advanceTimersByTimeAsync(60_000);
            expect(bot.asked).toBe(1);
        } finally {
            stop();
            vi.useRealTimers();
        }
    });

    it('lengthening the interval pushes the next backup out rather than firing one', async () => {
        vi.useFakeTimers();
        const bot = askCounter();
        let minutes = 10;
        const stop = scheduled(bot, () => minutes);

        try {
            await vi.advanceTimersByTimeAsync(9 * 60_000);
            minutes = 24 * 60;

            // The gap it was nearly through is not the gap any more, so the tick that would
            // have fired now waits with everything else.
            await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(bot.asked).toBe(0);
        } finally {
            stop();
            vi.useRealTimers();
        }
    });

    it('stops when told to', async () => {
        vi.useFakeTimers();
        const bot = askCounter();
        const stop = scheduled(bot, () => MIN_BACKUP_MINUTES);
        stop();

        try {
            await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(bot.asked).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
