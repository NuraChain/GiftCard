// The tether rate the shop prices with: ONE NUMBER, typed into the console by the operator.
//
// Every card's price is a dollar figure multiplied by this, so the rate is still the most
// dangerous input the application has. What changed is where it comes from. It used to be
// read from two exchanges and cross-checked on a timer; that machinery is gone, along with
// its failure modes - a blocked host, a halted market, a quiet unit change, a shop that shut
// itself at 3am because an API was down. The operator now owns the number outright.
//
// WHAT THAT TRADES AWAY, stated plainly: nothing here can tell whether the rate is RIGHT any
// more. There is no second source to disagree with it, so a mistyped rate is a real price
// until somebody notices. Two things stand in for the cross-check:
//
//   THE BAND. A rate outside MIN_TETHER_TOMAN..MAX_TETHER_TOMAN is refused rather than
//   stored (see domain/pricing.ts and settings.ts). That catches the extra zero and the
//   missing one - the mistakes that cost ten times the money - and nothing finer.
//
//   THE AGE. A hand-set rate has no idea the Toman moved underneath it, so `stale` is on
//   every path out of here: the ticker says so on the storefront and the console says so in
//   the pricing panel, both from the timestamp `save` stamps when the number changes.
//
// A STALE RATE STILL SELLS, and that is deliberate. The old grace window existed because a
// refresh was coming to fix things; nothing refreshes this one, so expiring it would shut the
// shop at an hour of the clock's choosing with no way back except an operator who is asleep.
// Selling on a rate the shop is visibly shouting about is the better failure. THE ONE THING
// THAT CLOSES THE SHOP IS NO RATE AT ALL - a fresh install before anybody has set one.
//
// NOTHING IS CACHED HERE. The settings reader is called per request, so a rate saved in the
// panel prices the very next page load - no restart, no refresh, no timer.
import { MAX_TETHER_TOMAN, MIN_TETHER_TOMAN } from '../../domain/pricing.ts';

/**
 * How old a rate gets before the shop starts saying so.
 *
 * Six hours is a working day's worth of drift: long enough that an operator setting the rate
 * morning and evening never sees the warning, short enough that yesterday's number cannot sit
 * there looking current. It marks, it does not expire - see the note above.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** A rate good enough to price with. Only ./rate.ts can mint one. */
export interface RateSnapshot {
    /** One USDT in Toman, as the console last set it. */
    toman: number;

    /** When it was set. The page turns this into «چند ساعت پیش». */
    at: string;

    /** Older than STALE_AFTER_MS - shown, never hidden, and still sellable. */
    stale: boolean;
}

/** Everything the console needs to answer "why is the shop shut". */
export interface RateStatus {
    /** The rate in force, or null when nothing has been set. */
    rate: RateSnapshot | null;

    /** Whether a card can be bought right now. */
    selling: boolean;

    /** Empty while healthy; otherwise why there is no price. */
    reason: string;

    /** Seconds since the rate was set, or null when there is none. */
    ageSeconds: number | null;
}

export interface TetherRate {
    /**
     * The rate to price with, or NULL when the shop must stop selling. Every caller has to
     * handle the null - that is the point of the type, and there is no fallback number to
     * reach for.
     */
    current(): RateSnapshot | null;

    /** The whole picture, for the console. Never null - it explains the null in `current()`. */
    status(): RateStatus;
}

export interface TetherRateOptions {
    /**
     * The stored rate and when it was set. Read PER CALL, the same way the gateway and the
     * mailer take their credentials: the console can change this between two requests and the
     * second one must be priced with the new number.
     */
    settings: () => { tetherToman: number; tetherSetAt: string };

    /** Injected for tests, which need to age a rate without waiting six hours. */
    now?: () => number;
}

export function createTetherRate(options: TetherRateOptions): TetherRate {
    const now = options.now ?? ((): number => Date.now());

    function snapshot(): RateSnapshot | null {
        const { tetherToman, tetherSetAt } = options.settings();

        // Zero is what `settings.ts` returns for unset, empty, unreadable and out-of-band, so
        // every one of those arrives here as the same thing: no price.
        if (tetherToman < MIN_TETHER_TOMAN || tetherToman > MAX_TETHER_TOMAN) {
            return null;
        }

        // `save` writes the number and its timestamp together, so a rate without a readable
        // one has been edited into the database by hand. It is refused rather than shown: a
        // price whose vintage cannot be stated is one the ticker would have to lie about, and
        // the whole reason `stale` exists is that the age is part of the number.
        const setAt = Date.parse(tetherSetAt);
        if (Number.isNaN(setAt)) {
            return null;
        }

        return {
            toman: tetherToman,
            at: tetherSetAt,
            stale: now() - setAt > STALE_AFTER_MS
        };
    }

    return {
        current: snapshot,

        status(): RateStatus {
            const rate = snapshot();
            const { tetherToman } = options.settings();
            return {
                rate,
                selling: rate !== null,
                reason:
                    rate !== null
                        ? ''
                        : tetherToman === 0
                          ? 'نرخ تتر هنوز در پنل تنظیم نشده است'
                          : 'نرخ تتر ذخیره‌شده معتبر نیست - دوباره ثبتش کنید',
                ageSeconds: rate === null ? null : Math.round((now() - Date.parse(rate.at)) / 1000)
            };
        }
    };
}
