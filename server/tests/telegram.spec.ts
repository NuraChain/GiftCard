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
import { createTelegram, type Telegram } from '../src/features/telegram/telegram.ts';
import { DEFAULT_BACKUP_MINUTES, MIN_BACKUP_MINUTES } from '../src/features/settings/contract.ts';

const SETTINGS = {
    botToken: '1234:TOKEN',
    chatId: '-100999',
    baseUrl: 'https://telegram.test'
};

const SALE: Sale = {
    amount: 10,
    toman: 1_309_000,
    email: 'buyer@example.com',
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
        sendDocument: () => Promise.resolve({ ok: true })
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

describe('the sale notification', () => {
    it('says what sold, for how much, and to whom', () => {
        const bot = spyBot();
        createSaleNotifier({ telegram: bot, appName: () => 'اشبرینگر' }).sold(SALE);

        expect(bot.sent).toHaveLength(1);
        expect(bot.sent[0]).toContain('10');
        expect(bot.sent[0]).toContain('1,309,000');
        expect(bot.sent[0]).toContain('buyer@example.com');
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
            }
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
            sendDocument: () => Promise.resolve({ ok: true })
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
        sendDocument: () => Promise.resolve({ ok: true })
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
