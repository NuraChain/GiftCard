// Running the shop from a phone: the bot's command side.
//
// The rate moves during the day and the person who knows it is usually not at a desk. This is
// the shortest path between "tether is 245,000 now" and every card being priced off it -
// `/setprice 245000` in a chat, and the shop is repriced before the phone goes back in a
// pocket. No console, no laptop, no VPN.
//
// ONE CHAT MAY GIVE ORDERS, AND IT IS THE ONE IN THE SETTINGS. Anyone can find a bot and
// message it, so the chat id on every update is checked against the configured one before a
// single character of the text is looked at. A message from anywhere else is counted, logged
// and DROPPED WITHOUT A REPLY - answering a stranger confirms the bot is live and hands them a
// free way to make this shop send messages.
//
// THE BOT TOKEN IS NOT A PASSWORD FOR THIS. It authenticates the shop TO Telegram; it does not
// prove who is typing. What actually stands between a stranger and the price of every card is
// that they would have to be inside the operator's own chat - so that chat's security is this
// feature's security, and an operator who adds the bot to a public group has given the group
// the price controls. The reply to `/help` says so.
//
// WHAT IS DELIBERATELY NOT HERE: anything that reveals a gift code, and anything that moves
// money. Codes are bearer value and a chat history is not where they live (see ./telegram.ts);
// the merchant id and the admin key stay in the console behind a session. This can set a price
// and read a count - the two things worth doing from a bus.
import type { Logger } from '../../platform/logging.ts';
import type { Store } from '../../db/types.ts';
import { MAX_TETHER_TOMAN, MIN_TETHER_TOMAN, tomanPrice } from '../../domain/pricing.ts';
import type { TetherRate } from '../rate/rate.ts';
import { MAX_MARGIN_PERCENT, type Settings } from '../settings/settings.ts';
import type { BackupJob } from './notify.ts';
import type { Telegram } from './telegram.ts';

/**
 * How long each poll waits for a message before coming back empty.
 *
 * This is Telegram's own long-poll: the request is held open at their end and answers the
 * instant a message arrives, so a high number here is LOWER latency and fewer requests, not
 * more. Thirty seconds is their usual recommendation.
 */
export const POLL_SECONDS = 30;

/** How long to wait before looking again after a failed cycle, or while the bot is off. */
const RETRY_MS = 15_000;

/**
 * A quiet poll that returns faster than this did not wait, so it failed.
 *
 * THIS IS WHAT KEEPS THE LOOP FROM BECOMING A SPIN. A healthy empty cycle costs POLL_SECONDS
 * because Telegram holds the connection open; one that comes back instantly hit something -
 * an unreachable host, a 409 from a second poller, a body that would not parse - and `receive`
 * reports every one of those as "nothing arrived". Without a pause on that path, a network
 * outage becomes a tight `while` loop that pins a core and starves the event loop a checkout
 * is running on, which is the one thing this feature is not allowed to do.
 */
const FAST_RETURN_MS = 1_000;

/**
 * A rate this far from the one in force is answered with a warning as well as a confirmation.
 *
 * It is NOT a refusal. The band in domain/pricing.ts catches the missing or extra zero; this
 * catches the subtler slip - 24,500 typed for 245,000 lands inside the band and would quietly
 * sell every card at a tenth of its worth. A chat cannot ask "are you sure" and wait, so the
 * reply shouts instead, and the operator sees it a second later with the new prices beside it.
 */
const BIG_MOVE_PERCENT = 20;

export interface CommandBotOptions {
    telegram: Telegram;
    settings: Settings;
    rate: TetherRate;
    store: Store;
    backup: BackupJob;
    log?: Logger;
}

export interface CommandBot {
    /**
     * Answers ONE command. Separated from the polling loop on purpose: every command below is
     * tested through this, with no network, no timer and no bot.
     */
    handle(text: string): Promise<string>;

    /** Begins long-polling for commands. Returns the stop function. */
    start(): () => void;
}

export function createCommandBot(options: CommandBotOptions): CommandBot {
    const { telegram, settings, rate, store, backup, log } = options;

    /** @internal The shop's prices right now, one line each, or why there are none. */
    function priceLines(): string[] {
        const live = rate.current();
        if (live === null) {
            return ['قیمتی در دسترس نیست - نرخ تتر تنظیم نشده است.'];
        }
        const margin = settings.current().marginPercent;
        const tiers = store.tiers().filter((tier) => tier.active);
        if (tiers.length === 0) {
            return ['هیچ کارت فعالی برای فروش نیست.'];
        }
        return tiers.map(
            (tier) =>
                `  ${tier.amount}$ = ${money(tomanPrice(tier.amount, live.toman, margin))} تومان`
        );
    }

    const HELP = [
        'دستورهای موجود:',
        '',
        '/price - قیمت فعلی کارت‌ها',
        '/setprice <تومان> - ثبت نرخ تتر، مثال: /setprice 245000',
        '/margin <درصد> - ثبت درصد سود، مثال: /margin 6',
        '/stock - موجودی هر کارت',
        '/status - وضعیت کلی فروشگاه',
        '/backup - گرفتن پشتیبان همین حالا',
        '',
        'هشدار: هرکسی که در این گفت‌وگو باشد می‌تواند قیمت فروشگاه را عوض کند.',
        'این ربات را در گروه عمومی نگذارید.'
    ].join('\n');

    async function handle(text: string): Promise<string> {
        // The command is the first word, lowercased; `/setprice@myshopbot` is what Telegram
        // sends in a group, so anything after an @ is trimmed off before matching.
        const [head = '', ...rest] = text.trim().split(/\s+/);
        const command = head.toLowerCase().split('@')[0];
        const argument = rest.join(' ').trim();

        switch (command) {
            case '/start':
            case '/help':
                return HELP;

            case '/price': {
                const live = rate.current();
                const margin = settings.current().marginPercent;
                return [
                    live === null
                        ? 'نرخ تتر: تنظیم نشده'
                        : `نرخ تتر: ${money(live.toman)} تومان${live.stale ? ' (قدیمی)' : ''}`,
                    `درصد سود: ${margin}٪`,
                    '',
                    ...priceLines()
                ].join('\n');
            }

            case '/setprice': {
                if (argument === '') {
                    return 'عدد را هم بنویسید. مثال: /setprice 245000';
                }
                // Persian and Arabic-Indic digits arrive from a phone keyboard as often as
                // Latin ones, and `Number('۲۴۵۰۰۰')` is NaN. Normalised before parsing, or the
                // operator gets told their own keyboard is invalid.
                const wanted = Number(latinDigits(argument).replace(/[,٬\s]/g, ''));
                if (!Number.isFinite(wanted) || !Number.isInteger(wanted)) {
                    return 'نرخ باید یک عدد صحیح تومانی باشد. مثال: /setprice 245000';
                }
                if (wanted < MIN_TETHER_TOMAN || wanted > MAX_TETHER_TOMAN) {
                    return (
                        `نرخ باید بین ${money(MIN_TETHER_TOMAN)} و ` +
                        `${money(MAX_TETHER_TOMAN)} تومان باشد.`
                    );
                }

                const before = rate.current();
                settings.save({ tetherToman: wanted });

                // The prices are read back AFTER the save, from the same function the shop
                // uses - so what this message shows is what a buyer would be charged, not a
                // prediction of it.
                const lines = [`نرخ تتر روی ${money(wanted)} تومان ثبت شد.`, '', ...priceLines()];

                if (before !== null) {
                    const move = (Math.abs(wanted - before.toman) / before.toman) * 100;
                    if (move > BIG_MOVE_PERCENT) {
                        lines.unshift(
                            `هشدار: این نرخ ${Math.round(move)}٪ با نرخ قبلی ` +
                                `(${money(before.toman)} تومان) فرق دارد. اگر اشتباه بود، ` +
                                'همین حالا دوباره ثبتش کنید.',
                            ''
                        );
                    }
                }
                log?.warn({ toman: wanted }, 'tether rate set from telegram');
                return lines.join('\n');
            }

            case '/margin': {
                if (argument === '') {
                    return 'عدد را هم بنویسید. مثال: /margin 6';
                }
                const wanted = Number(latinDigits(argument).replace(/[٪%\s]/g, ''));
                if (!Number.isFinite(wanted) || wanted < 0 || wanted > MAX_MARGIN_PERCENT) {
                    return `درصد سود باید عددی بین ۰ تا ${MAX_MARGIN_PERCENT} باشد.`;
                }
                settings.save({ marginPercent: wanted });
                log?.warn({ marginPercent: wanted }, 'margin set from telegram');
                return [`درصد سود روی ${wanted}٪ ثبت شد.`, '', ...priceLines()].join('\n');
            }

            case '/stock': {
                const stock = store.stock();
                if (stock.length === 0) {
                    return 'هیچ کدی در انبار نیست.';
                }
                const total = stock.reduce((sum, line) => sum + line.available, 0);
                return [
                    'موجودی:',
                    ...stock.map((line) => `  ${line.amount}$ = ${line.available} عدد`),
                    '',
                    `جمع: ${total} کد`
                ].join('\n');
            }

            case '/status': {
                const status = rate.status();
                const live = status.rate;
                const total = store.stock().reduce((sum, line) => sum + line.available, 0);
                return [
                    `فروش: ${status.selling ? 'باز' : 'بسته'}`,
                    live === null
                        ? `نرخ تتر: تنظیم نشده${status.reason === '' ? '' : ` (${status.reason})`}`
                        : `نرخ تتر: ${money(live.toman)} تومان${live.stale ? ' - قدیمی شده' : ''}`,
                    `درصد سود: ${settings.current().marginPercent}٪`,
                    `موجودی: ${total} کد`,
                    `ایمیل: ${settings.view('').mailReady ? 'آماده' : 'خاموش'}`
                ].join('\n');
            }

            case '/backup': {
                // The whole database, which is every unsold code. It goes to THIS chat, which
                // is the one the operator configured - the same trade ./telegram.ts describes.
                const result = await backup.runNow();
                return result.ok ? 'پشتیبان ارسال شد.' : `پشتیبان‌گیری انجام نشد: ${result.reason}`;
            }

            default:
                // Silence would look like a broken bot; the whole menu is two lines away.
                return `دستور «${command}» را نمی‌شناسم.\n\n${HELP}`;
        }
    }

    return {
        handle,

        start(): () => void {
            let stopped = false;

            // Set while the loop is sleeping, so stopping does not have to wait out a pause.
            let wake: (() => void) | null = null;

            const sleep = (ms: number): Promise<void> =>
                new Promise((resolve) => {
                    const timer = setTimeout(resolve, ms);
                    // A pending pause must not be the reason a shutting-down process lingers.
                    timer.unref();
                    wake = (): void => {
                        clearTimeout(timer);
                        resolve();
                    };
                });

            // Telegram replays anything unacknowledged, so this is the only thing standing
            // between a restart and every old command running again. It advances past an
            // update whether or not the update was for us.
            let offset = 0;

            const loop = async (): Promise<void> => {
                // `for (;;)` with an explicit check rather than `while (!stopped)`: the flag is
                // flipped by the stop function this returns, which the loop-condition lint
                // cannot see from inside here.
                for (;;) {
                    if (stopped) {
                        return;
                    }
                    if (!telegram.configured()) {
                        // No token yet. One may be pasted into the console at any moment, so
                        // this keeps looking rather than giving up until a restart.
                        await sleep(RETRY_MS);
                        continue;
                    }

                    const startedAt = Date.now();
                    const updates = await telegram.receive(offset, POLL_SECONDS);

                    if (updates.length === 0) {
                        if (Date.now() - startedAt < FAST_RETURN_MS) {
                            await sleep(RETRY_MS);
                        }
                        continue;
                    }

                    for (const update of updates) {
                        offset = Math.max(offset, update.updateId + 1);
                        if (stopped) {
                            return;
                        }

                        const live = settings.current();
                        // THE GATE. Everything past this line acts on the shop.
                        if (
                            update.chatId !== live.telegramChatId &&
                            update.chatUsername !== live.telegramChatId
                        ) {
                            log?.warn(
                                { chatId: update.chatId },
                                'telegram command from an unknown chat - ignored'
                            );
                            continue;
                        }

                        try {
                            await telegram.sendMessage(await handle(update.text));
                        } catch (error) {
                            // A command that throws must not end the loop - the next one may
                            // be the one that reopens the shop.
                            log?.error({ err: error }, 'telegram command failed');
                        }
                    }
                }
            };

            void loop().catch((error: unknown) => {
                log?.error({ err: error }, 'telegram command loop stopped');
            });

            return (): void => {
                stopped = true;
                wake?.();
            };
        }
    };
}

/** @internal Digit grouping, in the Latin digits a chat renders predictably. */
function money(value: number): string {
    return value.toLocaleString('en-US');
}

/**
 * @internal Persian and Arabic-Indic digits rewritten as ASCII.
 *
 * A Persian phone keyboard types `۲۴۵۰۰۰`, and `Number()` makes NaN of it. Rejecting that as
 * "not a number" would be this shop telling its own operator that their keyboard is wrong.
 */
function latinDigits(value: string): string {
    return value.replace(/[۰-۹٠-٩]/g, (digit) => {
        const code = digit.charCodeAt(0);
        const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
        return String(code - base);
    });
}
