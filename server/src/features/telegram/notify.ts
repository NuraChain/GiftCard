// The two jobs Telegram does: say when something sells, and carry the database off this
// machine once an hour.
//
// NEITHER MAY EVER BREAK A PURCHASE. That is the rule both halves are built around. The
// notification is fire-and-forget - `sold()` returns void, on purpose, so no caller can
// accidentally await it and put a chat server on the path between a buyer and their code. The
// backup runs on its own timer, touches nothing the shop is using, and compresses off the
// event loop (platform/zip.ts) so a checkout in flight never waits on it.
//
// THE BACKUP IS SENT AS A ZIP. A SQLite file is mostly page padding and repeated text, so it
// deflates to a small fraction of itself - which pushes the 50MB ceiling Telegram puts on a
// bot upload much further away, costs less of somebody's data allowance to pull down on a
// phone, and arrives as one file every operating system can open without a tool.
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from '../../platform/logging.ts';
import { zipOne } from '../../platform/zip.ts';
import type { Store } from '../../db/types.ts';
import type { Telegram, TelegramResult } from './telegram.ts';

/** How often the database is sent. */
export const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Telegram refuses a bot upload over 50MB. This shop's database is codes and orders - text -
 * so passing it would take a very long time and a great many sales, but a backup that fails
 * silently at 3am is exactly the kind of thing nobody notices until they need the backup.
 *
 * MEASURED AGAINST THE ZIP, not the database, because the zip is what is actually uploaded. A
 * SQLite file that deflates ten to one reaches this ceiling ten times later than it used to.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** What sold, in the terms an operator reads on their phone. */
export interface Sale {
    amount: number;
    toman: number;
    email: string;
    refId: number | null;

    /** The receipt handle, which is what support quotes back to a buyer. */
    receipt: string;

    /** How many of that denomination are left afterwards. */
    remaining: number;

    /** False is the OWED state: money verified, no code available. It needs a human. */
    codeDelivered: boolean;
}

export interface SaleNotifier {
    /**
     * Announces a sale. Returns VOID rather than a promise, deliberately: a notification is
     * not allowed to be on the critical path of a payment, and a signature nobody can await
     * is the only way to guarantee that stays true as this code is edited.
     */
    sold(sale: Sale): void;
}

export interface SaleNotifierOptions {
    telegram: Telegram;

    /** The shop's name, so an operator running two of these can tell them apart. */
    appName: () => string;

    log?: Logger;
}

export function createSaleNotifier(options: SaleNotifierOptions): SaleNotifier {
    return {
        sold(sale) {
            if (!options.telegram.configured()) {
                return;
            }

            // NO CODE IN THIS MESSAGE. See the header of ./telegram.ts - a gift code is
            // bearer value and a chat history is not where the shop's inventory should live.
            const lines = [
                sale.codeDelivered
                    ? `فروش جدید - ${options.appName()}`
                    : `فروش بدون کد - ${options.appName()}`,
                '',
                `کارت: ${sale.amount} دلاری`,
                `مبلغ: ${sale.toman.toLocaleString('en-US')} تومان`,
                `خریدار: ${sale.email}`,
                `پیگیری: ${sale.refId ?? '-'}`,
                `رسید: ${sale.receipt}`,
                `موجودی باقی‌مانده: ${sale.remaining}`
            ];

            if (!sale.codeDelivered) {
                lines.push(
                    '',
                    'هشدار: پول گرفته شد ولی کدی برای تحویل نبود. این سفارش نیاز به رسیدگی دارد.'
                );
            }

            // Fire and forget, with the failure logged rather than thrown. A chat server
            // being down is not a reason for anything else here to notice.
            void options.telegram
                .sendMessage(lines.join('\n'))
                .then((result) => {
                    if (!result.ok) {
                        options.log?.warn({ reason: result.reason }, 'sale notification failed');
                    }
                })
                .catch(() => {
                    options.log?.warn('sale notification failed');
                });
        }
    };
}

export interface BackupJob {
    /** Takes a backup and sends it, now. The console's button and the timer share this. */
    runNow(): Promise<TelegramResult>;

    /** Begins the hourly schedule. Returns the stop function. */
    start(): () => void;
}

export interface BackupJobOptions {
    store: Store;
    telegram: Telegram;
    appName: () => string;
    log?: Logger;

    /** Overridden by tests so a backup does not land in the real temp directory. */
    scratchDir?: string;
}

export function createBackupJob(options: BackupJobOptions): BackupJob {
    let running = false;

    async function backup(): Promise<TelegramResult> {
        if (!options.telegram.configured()) {
            return { ok: false, reason: 'telegram is not configured' };
        }
        if (running) {
            // An hourly job that overlaps itself is a job that has already gone wrong. The
            // second caller is told rather than queued.
            return { ok: false, reason: 'a backup is already running' };
        }
        running = true;

        // Colons are legal in a filename on Linux and illegal on Windows, and this string
        // becomes both a path here and a filename in a chat. Dashes work everywhere and
        // still sort correctly, which is what an operator scrolling a year of these needs.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const name = `guardian-service-${stamp}.db`;
        const archive = `guardian-service-${stamp}.zip`;
        const path = join(options.scratchDir ?? tmpdir(), name);

        try {
            // A CONSISTENT snapshot, taken through SQLite itself. Copying the file by hand
            // while the shop is trading would capture a half-written page and a WAL that
            // does not match it - a backup that restores to nothing.
            options.store.backupTo(path);

            const bytes = await readFile(path);

            // Compressed BEFORE the size is judged: the ceiling belongs to the upload, and the
            // upload is the zip. The .db name is kept for the entry INSIDE the archive, so an
            // operator who extracts it gets a file SQLite opens by its own extension.
            const zipped = await zipOne(name, bytes);
            if (zipped.byteLength > MAX_UPLOAD_BYTES) {
                return {
                    ok: false,
                    reason: `backup is ${zipped.byteLength} bytes compressed, too large to send`
                };
            }

            const caption =
                `پشتیبان‌گیری ${options.appName()}\n` +
                `${new Date().toISOString()}\n` +
                `${Math.round(zipped.byteLength / 1024)} کیلوبایت ` +
                `(فشرده از ${Math.round(bytes.byteLength / 1024)} کیلوبایت)`;

            const sent = await options.telegram.sendDocument(archive, zipped, caption);
            if (!sent.ok) {
                options.log?.error({ reason: sent.reason }, 'database backup not sent');
            } else {
                options.log?.info(
                    { bytes: zipped.byteLength, rawBytes: bytes.byteLength },
                    'database backup sent'
                );
            }
            return sent;
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'backup failed';
            options.log?.error({ reason }, 'database backup failed');
            return { ok: false, reason };
        } finally {
            running = false;
            // The snapshot is a COMPLETE COPY OF THE BUSINESS sitting in a world-readable
            // temp directory. It goes as soon as it has been read, whatever happened above.
            await unlink(path).catch(() => {
                options.log?.warn({ path }, 'could not remove the backup snapshot');
            });
        }
    }

    return {
        runNow: backup,

        start(): () => void {
            const timer = setInterval(() => void backup(), BACKUP_INTERVAL_MS);
            // The listening socket keeps the process alive; this timer should not be the
            // reason a shutting-down process lingers.
            timer.unref();
            return (): void => clearInterval(timer);
        }
    };
}
