// The operations bot: what it sends, what it refuses to send, and what it cleans up.
//
// The backup half is tested against a REAL SQLite database rather than a stub, because the
// thing most worth proving is that the snapshot it produces is a database somebody could
// actually restore - and a fake store would prove nothing about that at all.
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { createStore } from '../src/db/index.ts';
import { createBackupJob, createSaleNotifier, type Sale } from '../src/features/telegram/notify.ts';
import { createTelegram, type Telegram } from '../src/features/telegram/telegram.ts';
import type { Fetch } from '../src/features/checkout/zarinpal.ts';
import { keepPasswords, parseProxyUrl, type TelegramProxy } from '../src/contract/shared.ts';
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

const PROXY_ONE: TelegramProxy = {
    protocol: 'https',
    server: 'one.proxy.test',
    port: 8443,
    username: 'shop',
    password: 's3cret'
};
const PROXY_TWO: TelegramProxy = {
    protocol: 'http',
    server: 'two.proxy.test',
    port: 8080,
    username: '',
    password: ''
};

/** The same bot, with a list of proxies to reach the API host through. */
const PROXIED = { ...SETTINGS, proxies: [PROXY_ONE, PROXY_TWO] };

/**
 * Proxies that never open a socket. A server named in `dead` refuses the tunnel; any other
 * carries the request to an API host that says `answer`.
 */
function fakeProxies(answer: unknown = { ok: true }) {
    const state = {
        dead: new Set<string>(),
        answer,
        /** Which proxy was asked to carry what, in order - whether or not it did. */
        tried: [] as Array<{ via: string; password: string; url: string; init?: RequestInit }>
    };
    const through =
        (proxy: TelegramProxy): Fetch =>
        (url, init) => {
            state.tried.push({ via: proxy.server, password: proxy.password, url, init });
            if (state.dead.has(proxy.server)) {
                // The shape a real failure has: fetch says nothing, and the reason is under it.
                return Promise.reject(
                    new TypeError('fetch failed', {
                        cause: new Error('connect ECONNREFUSED 10.0.0.1:8080')
                    })
                );
            }
            return Promise.resolve(new Response(JSON.stringify(state.answer)));
        };
    return { state, through, via: (): string[] => state.tried.map((attempt) => attempt.via) };
}

/** Starts a server on a port of the machine's choosing, and says which. */
function listening(server: Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
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

describe('the telegram client, through proxies', () => {
    it('goes through the first proxy that works and leaves the API host alone', async () => {
        const spy = recorder();
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            through: fake.through
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(fake.via()).toEqual([PROXY_ONE.server, PROXY_TWO.server]);
        // The same request to the same API host. Only the road is different.
        expect(fake.state.tried[1].url).toBe('https://telegram.test/bot1234:TOKEN/sendMessage');
        expect(spy.calls).toHaveLength(0);
    });

    it('does not pay for a dead proxy on every message, and returns to it when it must', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const fake = fakeProxies();
            fake.state.dead.add(PROXY_ONE.server);
            const telegram = createTelegram({ settings: () => PROXIED, through: fake.through });

            await telegram.sendMessage('one');
            await telegram.sendMessage('two');
            expect(fake.via()).toEqual([PROXY_ONE.server, PROXY_TWO.server, PROXY_TWO.server]);

            // Long after the first has had its rest, the one that works is still where a
            // message starts: the list is walked again when there is a reason to, not on a
            // timer.
            vi.setSystemTime(Date.now() + 10 * 60_000);
            await telegram.sendMessage('three');
            expect(fake.via().slice(3)).toEqual([PROXY_TWO.server]);

            fake.state.dead.clear();
            fake.state.dead.add(PROXY_TWO.server);
            expect(await telegram.sendMessage('four')).toEqual({ ok: true });
            expect(fake.via().slice(4)).toEqual([PROXY_TWO.server, PROXY_ONE.server]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('falls back to the API host when no proxy will carry the message', async () => {
        const spy = recorder();
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            through: fake.through
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(spy.calls.map((call) => call.url)).toEqual([
            'https://telegram.test/bot1234:TOKEN/sendMessage'
        ]);

        // And the dead list is left alone for a while rather than tried again per message.
        await telegram.sendMessage('again');
        expect(fake.state.tried).toHaveLength(2);
        expect(spy.calls).toHaveLength(2);
    });

    it('does not rest its only proxy when there is no other way to Telegram', async () => {
        // The shop this list exists for: one proxy, and an API host it cannot reach. A tunnel
        // that drops once must not mean a minute of sales and payouts nobody is told about.
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({
            settings: () => ({ ...PROXIED, proxies: [PROXY_ONE] }),
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            through: fake.through
        });
        expect((await telegram.sendMessage('dropped')).ok).toBe(false);

        fake.state.dead.clear();

        expect(await telegram.sendMessage('a moment later')).toEqual({ ok: true });
    });

    it('asks one resting proxy per message, not the whole list, when every one has failed', async () => {
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            through: fake.through
        });

        await telegram.sendMessage('one');
        await telegram.sendMessage('two');
        await telegram.sendMessage('three');

        // Both on the first message, then the one left alone longest, turn about: a dead list
        // costs each message one attempt however long it is, and a proxy that comes back is
        // found within a message or two.
        expect(fake.via()).toEqual([
            PROXY_ONE.server,
            PROXY_TWO.server,
            PROXY_ONE.server,
            PROXY_TWO.server
        ]);
    });

    it('says so when no road gets there at all', async () => {
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server).add(PROXY_TWO.server);
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            through: fake.through
        });

        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'telegram unreachable'
        });
    });

    it('stops at the first answer, whatever it says', async () => {
        // A refusal is Telegram's, and every other road leads to the same Telegram. Asking
        // again through the next proxy would get the same answer, twenty times over.
        const spy = recorder();
        const fake = fakeProxies({ ok: false, description: 'Bad Request: chat not found' });
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            through: fake.through
        });

        expect(await telegram.sendMessage('hello')).toEqual({
            ok: false,
            reason: 'Bad Request: chat not found'
        });
        expect(fake.via()).toEqual([PROXY_ONE.server]);
        expect(spy.calls).toHaveLength(0);
    });

    it('takes a page that is not a Bot API answer for a road that did not arrive', async () => {
        const fake = fakeProxies(null);
        const spy = recorder();
        const telegram = createTelegram({
            settings: () => PROXIED,
            fetch: spy.fetch,
            through: fake.through
        });

        expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
        expect(spy.calls).toHaveLength(1);
    });

    it('uploads through a proxy exactly as it does without one', async () => {
        const fake = fakeProxies();
        const telegram = createTelegram({ settings: () => PROXIED, through: fake.through });

        expect(
            await telegram.sendDocument('backup.zip', new Uint8Array([1, 2, 3]), 'caption')
        ).toEqual({ ok: true });

        const [attempt] = fake.state.tried;
        expect(attempt.url).toBe('https://telegram.test/bot1234:TOKEN/sendDocument');
        expect(attempt.init?.body).toBeInstanceOf(FormData);
        expect(attempt.init?.headers).toEqual({});
    });

    it('polls for commands through the proxy, from the offset it was given', async () => {
        const result = [{ update_id: 41, message: { text: '/status', chat: { id: -100999 } } }];
        const fake = fakeProxies({ ok: true, result });
        const telegram = createTelegram({ settings: () => PROXIED, through: fake.through });

        expect(await telegram.receive(41, 0)).toEqual([
            { updateId: 41, chatId: '-100999', chatUsername: '', text: '/status' }
        ]);
        expect(fake.via()).toEqual([PROXY_ONE.server]);
        // The same queue and the same cursor as without a proxy: nothing is replayed or
        // skipped when the road changes.
        expect(JSON.parse(String(fake.state.tried[0].init?.body))).toMatchObject({ offset: 41 });
    });

    it('tries a proxy again at once when the console changes it', async () => {
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server);
        let live = PROXIED;
        const telegram = createTelegram({ settings: () => live, through: fake.through });
        await telegram.sendMessage('before');

        // A wrong password is the usual reason a proxy fails, and fixing it should not have
        // to wait out the rest the wrong one earned.
        fake.state.dead.clear();
        live = { ...PROXIED, proxies: [{ ...PROXY_ONE, password: 'fixed' }] };
        await telegram.sendMessage('after');

        expect(fake.state.tried.at(-1)).toMatchObject({
            via: PROXY_ONE.server,
            password: 'fixed'
        });
    });

    it('tests one proxy with a request that carries no token', async () => {
        const fake = fakeProxies();
        const telegram = createTelegram({ settings: () => SETTINGS, through: fake.through });

        const result = await telegram.testProxy(PROXY_TWO);

        expect(result).toMatchObject({ ok: true, reason: '' });
        expect(fake.state.tried.map((attempt) => attempt.url)).toEqual(['https://telegram.test']);
    });

    it('says why a proxy failed its test, not that fetch failed', async () => {
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({ settings: () => SETTINGS, through: fake.through });

        expect(await telegram.testProxy(PROXY_ONE)).toMatchObject({
            ok: false,
            reason: 'connect ECONNREFUSED 10.0.0.1:8080'
        });
    });

    it('words the two failures that have no words of their own', async () => {
        const failing = (cause: Error): Telegram =>
            createTelegram({
                settings: () => SETTINGS,
                through: () => () => Promise.reject(new TypeError('fetch failed', { cause }))
            });

        // A name that resolves to two addresses fails once for each, in an error whose own
        // message is empty.
        const both = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:9')], '');
        expect(await failing(both).testProxy(PROXY_ONE)).toMatchObject({
            reason: 'connect ECONNREFUSED 127.0.0.1:9'
        });

        // And https:// chosen for a proxy that only speaks http is a line of OpenSSL.
        const handshake = Object.assign(
            new Error('1C5A0000:error:0A0000C6:SSL routines:tls_get_more_records'),
            { code: 'ERR_SSL_PACKET_LENGTH_TOO_LONG' }
        );
        expect(await failing(handshake).testProxy(PROXY_ONE)).toMatchObject({
            reason: 'TLS failed: ERR_SSL_PACKET_LENGTH_TOO_LONG'
        });
    });

    it('uses a proxy that has just passed its test, resting or not', async () => {
        const fake = fakeProxies();
        fake.state.dead.add(PROXY_ONE.server);
        const telegram = createTelegram({
            settings: () => ({ ...PROXIED, proxies: [PROXY_ONE] }),
            fetch: () => Promise.reject(new Error('ECONNREFUSED')),
            through: fake.through
        });
        expect((await telegram.sendMessage('before')).ok).toBe(false);

        // The operator fixes the proxy, presses the test button, sees it pass - and the test
        // message they send next must not be the one that is told the bot cannot be reached.
        fake.state.dead.clear();
        expect((await telegram.testProxy(PROXY_ONE)).ok).toBe(true);

        expect(await telegram.sendMessage('after')).toEqual({ ok: true });
    });
});

describe('the telegram client, through a real proxy', () => {
    it('tunnels a message and an upload to the API host, signed in to the proxy', async () => {
        // THE ONE TEST HERE THAT OPENS SOCKETS, all of them on this machine. Everything above
        // hands the client a fake road; this is the real one, and what it proves cannot be
        // faked: that the proxy agent from the `undici` package and the `fetch` that comes with
        // Node still understand each other. See features/telegram/proxy.ts.
        const sockets = new Set<{ destroy(): unknown }>();
        const arrived: Array<{ path: string; type: string; body: string }> = [];
        const api = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.on('end', () => {
                arrived.push({
                    path: request.url ?? '',
                    type: request.headers['content-type'] ?? '',
                    body: Buffer.concat(chunks).toString('latin1')
                });
                response.setHeader('content-type', 'application/json');
                response.end('{"ok":true}');
            });
        });

        const tunnels: Array<{ to: string; login: string }> = [];
        const proxy = createServer();
        proxy.on('connect', (request, socket) => {
            const to = request.url ?? '';
            tunnels.push({ to, login: request.headers['proxy-authorization'] ?? '' });
            const [host, port] = to.split(':');
            const upstream = connect(Number(port), host, () => {
                socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                upstream.pipe(socket);
                socket.pipe(upstream);
            });
            sockets.add(socket).add(upstream);
        });

        const apiPort = await listening(api);
        const proxyPort = await listening(proxy);
        try {
            const telegram = createTelegram({
                settings: () => ({
                    ...SETTINGS,
                    baseUrl: `http://127.0.0.1:${apiPort}`,
                    proxies: [
                        {
                            protocol: 'http',
                            server: '127.0.0.1',
                            port: proxyPort,
                            username: 'shop',
                            // Everything that would need escaping in an address.
                            password: 'p@ss:w/rd #1'
                        }
                    ]
                })
            });

            expect(await telegram.sendMessage('hello')).toEqual({ ok: true });
            expect(
                await telegram.sendDocument('backup.zip', new Uint8Array(70_000), 'caption')
            ).toEqual({ ok: true });

            // Through the proxy, not around it - the API host would have answered either way.
            expect(tunnels.length).toBeGreaterThan(0);
            for (const tunnel of tunnels) {
                expect(tunnel).toEqual({
                    to: `127.0.0.1:${apiPort}`,
                    login: `Basic ${Buffer.from('shop:p@ss:w/rd #1').toString('base64')}`
                });
            }

            const [message, upload] = arrived;
            expect(message.path).toBe('/bot1234:TOKEN/sendMessage');
            expect(JSON.parse(message.body)).toMatchObject({ chat_id: '-100999', text: 'hello' });
            expect(upload.path).toBe('/bot1234:TOKEN/sendDocument');
            expect(upload.type).toMatch(/^multipart\/form-data; boundary=/);
            expect(upload.body).toContain('filename="backup.zip"');
            expect(upload.body.length).toBeGreaterThan(70_000);
        } finally {
            for (const socket of sockets) {
                socket.destroy();
            }
            api.closeAllConnections();
            api.close();
            proxy.close();
        }
    });
});

describe('a proxy address', () => {
    it('is read the way a proxy is handed around', () => {
        expect(parseProxyUrl('  https://shop:p%40ss@proxy.example.com:8443 ')).toEqual({
            protocol: 'https',
            server: 'proxy.example.com',
            port: 8443,
            username: 'shop',
            password: 'p@ss'
        });
        // No scheme is plain http, and no port is the one the scheme implies.
        expect(parseProxyUrl('1.2.3.4:3128')).toEqual({
            protocol: 'http',
            server: '1.2.3.4',
            port: 3128,
            username: '',
            password: ''
        });
        expect(parseProxyUrl('https://proxy.example.com')).toMatchObject({ port: 443 });
        expect(parseProxyUrl('http://[2001:db8::1]:8080')).toMatchObject({
            server: '2001:db8::1',
            port: 8080
        });
    });

    it('reads nothing out of a proxy the bot cannot use', () => {
        expect(parseProxyUrl('socks5://1.2.3.4:1080')).toBeNull();
        expect(parseProxyUrl('tg://proxy?server=1.2.3.4&port=443&secret=00')).toBeNull();
        expect(parseProxyUrl('http://1.2.3.4:99999')).toBeNull();
        expect(parseProxyUrl('')).toBeNull();
    });
});

describe('a proxy password left blank', () => {
    const stored: TelegramProxy[] = [PROXY_ONE];

    it('is the one already stored for that address', () => {
        expect(keepPasswords([{ ...PROXY_ONE, password: '' }], stored)).toEqual([PROXY_ONE]);
        // A new one replaces it.
        expect(keepPasswords([{ ...PROXY_ONE, password: 'new' }], stored)).toEqual([
            { ...PROXY_ONE, password: 'new' }
        ]);
    });

    it('does not follow the row to another address', () => {
        // Otherwise the console could be used to send a stored password to a machine of
        // somebody's choosing: point the row at it, leave the box empty, press test.
        for (const moved of [
            { server: 'elsewhere.test' },
            { port: 1 },
            { protocol: 'http' as const },
            { username: 'other' }
        ]) {
            expect(keepPasswords([{ ...PROXY_ONE, ...moved, password: '' }], stored)).toEqual([
                { ...PROXY_ONE, ...moved, password: '' }
            ]);
        }
    });

    it('is no password at all once there is no name to sign in with', () => {
        expect(keepPasswords([{ ...PROXY_ONE, username: '', password: 'left over' }], [])).toEqual([
            { ...PROXY_ONE, username: '', password: '' }
        ]);
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
