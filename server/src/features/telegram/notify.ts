// The three jobs Telegram does: say when something sells, say when a code is cashed out, and
// carry the database off this machine on a timer.
//
// NEITHER MAY EVER BREAK A PURCHASE. That is the rule both halves are built around. The
// notification is fire-and-forget - `sold()` returns void, on purpose, so no caller can
// accidentally await it and put a chat server on the path between a buyer and their code. The
// backup runs on its own schedule, reads inside a read-only snapshot that blocks no purchase,
// and compresses off the event loop (platform/zip.ts) so a checkout in flight never waits on it.
//
// THE PAYOUT NOTIFICATION IS THE EXCEPTION, AND IT IS AWAITED. `redeemed()` returns a result
// rather than void because this message is not an FYI - it is the ONLY thing that tells a
// human to send somebody money. A sale that nobody is pinged about is still a sale, recorded,
// paid for and delivered; a redemption nobody is pinged about is a person waiting forever. So
// the caller waits for the answer and records whether it arrived.
//
// THE BACKUP IS SENT AS A ZIP. A SQL dump is mostly repeated statement text, so it deflates to
// a small fraction of itself - which pushes the 50MB ceiling Telegram puts on a bot upload much
// further away, costs less of somebody's data allowance to pull down on a phone, and arrives as
// one file every operating system can open without a tool.
//
// IT NEVER TOUCHES THE DISK. The dump is a complete copy of the business, credentials
// included; built in memory and handed straight to the upload, it never sits in a temp
// directory for anyone else on the machine to read.
import type { Logger } from '../../platform/logging.ts';
import { zipOne } from '../../platform/zip.ts';
import type { Store } from '../../db/types.ts';
import type { Telegram, TelegramResult } from './telegram.ts';

/**
 * How often the schedule looks at the clock. NOT how often a backup is taken - that is
 * `everyMinutes`, a setting, and this is only the resolution at which a change to it is
 * noticed. See `start`.
 */
const TICK_MS = 60 * 1000;

/**
 * Telegram refuses a bot upload over 50MB. This shop's database is codes and orders - text -
 * so passing it would take a very long time and a great many sales, but a backup that fails
 * silently at 3am is exactly the kind of thing nobody notices until they need the backup.
 *
 * MEASURED AGAINST THE ZIP, not the dump, because the zip is what is actually uploaded. A dump
 * that deflates ten to one reaches this ceiling ten times later than the dump itself would.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** What sold, in the terms an operator reads on their phone. */
export interface Sale {
    amount: number;

    /** Zero on an English sale, which was paid in dollars - see `lang`. */
    toman: number;

    /** `en` was paid through NOWPayments at face value; `phone` is then the buyer's email. */
    lang: 'fa' | 'en';
    phone: string;
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
                sale.lang === 'en'
                    ? `مبلغ: ${sale.amount} دلار (NOWPayments، فروشگاه انگلیسی)`
                    : `مبلغ: ${sale.toman.toLocaleString('en-US')} تومان`,
                `خریدار: ${sale.phone}`,
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

/** A code cashed out, in the terms an operator reads before making a transfer. */
export interface Payout {
    /** The denomination being cashed, in dollars. What to send. */
    amount: number;

    /** Where to send it, exactly as the holder gave it - case included. */
    wallet: string;

    /** Which chain: `TRC20` or `ERC20`. Sending on the wrong one loses the money. */
    network: string;

    /** Who originally bought the code. Not necessarily the person redeeming it. */
    phone: string;

    /** The spent code. ONLY A PREFIX OF IT REACHES THE CHAT - see below. */
    code: string;

    claimedAt: string;
}

export interface PayoutNotifier {
    /**
     * Asks the operator to send a transfer, and reports whether the ask arrived.
     *
     * AWAITED, unlike {@link SaleNotifier.sold}. The header explains why: this message is the
     * only notice a human gets that money is owed, so its failure has to be recorded rather
     * than logged and forgotten.
     */
    redeemed(payout: Payout): Promise<TelegramResult>;
}

export interface PayoutNotifierOptions {
    telegram: Telegram;
    appName: () => string;
}

/**
 * How much of the spent code the operator is shown.
 *
 * ./telegram.ts says no gift code goes down this pipe, and this is the narrowest possible
 * exception to it. Eight characters is enough to find the row in the console and to match a
 * chat message against a redemption; it is 32 bits short of enough to redeem anything, which
 * matters because a redemption row can be lost - restored from an older backup, say - and the
 * code would be live again with the whole of it sitting in a chat history.
 */
const CODE_PREFIX = 8;

export function createPayoutNotifier(options: PayoutNotifierOptions): PayoutNotifier {
    return {
        redeemed(payout) {
            // THE ADDRESS GETS A LINE OF ITS OWN, with nothing before or after it. An
            // operator copies this by tapping it, and a line that also held a label or a
            // trailing full stop is a line that copies a broken address into a wallet.
            const lines = [
                `درخواست برداشت - ${options.appName()}`,
                '',
                `مبلغ: ${payout.amount} دلار (USDT)`,
                `شبکه: ${payout.network}`,
                'آدرس کیف پول:',
                payout.wallet,
                '',
                `خریدار کد: ${payout.phone}`,
                `کد: ${payout.code.slice(0, CODE_PREFIX)}...`,
                `زمان: ${payout.claimedAt}`,
                '',
                'کد مصرف شد و دیگر قابل استفاده نیست. انتقال را دستی انجام دهید.'
            ];
            return options.telegram.sendMessage(lines.join('\n'));
        }
    };
}

export interface BackupJob {
    /** Takes a backup and sends it, now. The console's button and the timer share this. */
    runNow(): Promise<TelegramResult>;

    /** Begins the schedule. Returns the stop function. */
    start(): () => void;
}

export interface BackupJobOptions {
    /** Only the dump: the one call a backup makes of the database. */
    store: Pick<Store, 'dumpSql'>;
    telegram: Telegram;
    appName: () => string;

    /**
     * The gap between automatic backups, in minutes.
     *
     * A FUNCTION, read on every tick, exactly like `appName` - it is a console setting now,
     * and an operator who shortens it after a scare must not have to restart the process for
     * the shorter gap to mean anything.
     */
    everyMinutes: () => number;

    log?: Logger;
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
        // becomes a filename on whichever machine the operator saves it to. Dashes work
        // everywhere and still sort correctly, which is what an operator scrolling a year of
        // these needs.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const name = `ashbringer-${stamp}.sql`;
        const archive = `ashbringer-${stamp}.zip`;

        try {
            // ONE CONSISTENT STATE of the whole database - see platform/dump.ts.
            const bytes = Buffer.from(await options.store.dumpSql(), 'utf8');

            // Compressed BEFORE the size is judged: the ceiling belongs to the upload, and the
            // upload is the zip. The .sql name is kept for the entry INSIDE the archive, so an
            // operator who extracts it gets a script psql runs as it is.
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
        }
    }

    return {
        runNow: backup,

        start(): () => void {
            // A CLOCK, NOT A PERIOD. `setInterval(backup, gap)` freezes the gap at the moment
            // it is armed: an operator who cut the interval from a day to ten minutes would
            // get the first short gap a day later, which is the one day it mattered. So this
            // ticks at a fixed resolution and asks each time how long it has actually been -
            // a change in the console is honoured within a tick, in both directions.
            //
            // The first backup lands one whole interval after boot, the way it always has. A
            // process that restarts often would otherwise upload the entire database on every
            // restart, which is the opposite of a safeguard.
            let lastRunAt = Date.now();

            const timer = setInterval(() => {
                const now = Date.now();
                if (now - lastRunAt < options.everyMinutes() * 60_000) {
                    return;
                }
                // Stamped BEFORE the run, so the gap is measured start-to-start and a slow
                // upload does not push every later backup further out. Overlap is refused by
                // `running` above rather than by the arithmetic here.
                lastRunAt = now;
                void backup();
            }, TICK_MS);

            // The listening socket keeps the process alive; this timer should not be the
            // reason a shutting-down process lingers.
            timer.unref();
            return (): void => clearInterval(timer);
        }
    };
}
