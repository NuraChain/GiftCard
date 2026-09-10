// The live tether rate, and the three rules that decide whether this shop is open.
//
// Every card's price is a dollar figure multiplied by a number that comes from outside this
// building. That makes the rate the single most dangerous input the application has: it is
// not validated by a schema, it is not signed, and the two exchanges that supply it can be
// slow, wrong, or unreachable without telling anybody. What follows is what stands between
// that and a card sold for a tenth of its worth.
//
//   RULE 1 - A RATE IS ONLY A RATE IF TWO SOURCES AGREE. Both exchanges must answer, and
//   their prices must sit within MAX_SPREAD_PERCENT of each other. One source answering is
//   not a quorum: the reason for asking twice is that a single answer cannot be checked
//   against anything. A disagreement is not resolved, averaged, or voted on - it is refused,
//   because two prices that differ by more than a fraction of a percent mean one of them is
//   broken and nothing here can tell which.
//
//   RULE 2 - THE LOWER OF THE TWO WINS. Having agreed, the cheaper reading is the one used.
//   The gap is at most MAX_SPREAD_PERCENT by rule 1 and the shop's margin covers it, so the
//   cost of this is small and known, and it always falls on the side of the buyer paying
//   less than the market rather than more.
//
//   RULE 3 - A STALE RATE HAS A DEADLINE. A failed refresh does not close the shop; the last
//   agreed rate keeps selling for GRACE_MS. Past that it stops being a price and becomes a
//   memory, `current()` returns null, and every card goes unbuyable until two sources agree
//   again. THE SHOP CLOSING IS THE CORRECT OUTCOME - the alternative is trading on a number
//   from an hour ago while the Toman moves underneath it.
//
// WHAT THIS DELIBERATELY DOES NOT DO: persist. A restart starts with no rate and the shop is
// shut for one refresh. Writing the last rate to disk would survive that, and would also
// survive a restart three days later, which is the failure this file exists to prevent. One
// refresh of downtime is the cheaper mistake.
import type { Logger } from '../../platform/logging.ts';

import type { RateReading, RateSource } from './sources.ts';

/** How often the exchanges are asked. */
export const REFRESH_MS = 60_000;

/**
 * How long an agreed rate keeps selling after refreshes start failing. Fifteen minutes is
 * long enough to ride out an exchange restart or a bad few minutes of routing, and short
 * enough that no card is ever sold against a price from a different hour.
 */
export const GRACE_MS = 15 * 60_000;

/**
 * How far apart the two exchanges may be before the reading is refused, in percent.
 *
 * Two healthy Iranian exchanges quoting the same pair sit well inside this. Anything wider is
 * one of them being wrong - a halt, a thin book, a unit change - and the shop would rather
 * shut than pick a side.
 */
export const MAX_SPREAD_PERCENT = 2;

/** Past this age the rate is still sellable but the shop says so. See GRACE_MS for the cliff. */
const STALE_AFTER_MS = 3 * REFRESH_MS;

/** A rate good enough to price with. Only ./rate.ts can mint one. */
export interface RateSnapshot {
    /** One USDT in Toman. */
    toman: number;

    /** When the two exchanges agreed on it. */
    at: string;

    /** True once the reading is older than a few refresh cycles - shown, never hidden. */
    stale: boolean;
}

/** Everything the console needs to answer "why is the shop shut". */
export interface RateStatus {
    /** The rate in force, or null when there is nothing sellable. */
    rate: RateSnapshot | null;

    /** Whether a card can be bought right now. */
    selling: boolean;

    /** Empty while healthy; otherwise what the last refresh could not do. */
    reason: string;

    /** Seconds since the rate was agreed, or null when there has never been one. */
    ageSeconds: number | null;

    /** What each exchange said on the last attempt, in the order they were asked. */
    readings: RateReading[];

    /** How far apart the last usable pair were, in percent. Null when they could not be read. */
    spreadPercent: number | null;
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

    /** One refresh, now. Overlapping calls share the one in flight. */
    refresh(): Promise<void>;

    /** Begins refreshing on a timer. Returns the stop function. */
    start(): () => void;
}

export interface TetherRateOptions {
    /**
     * The exchanges to cross-check. TWO OR MORE, always - one source cannot be checked
     * against anything, and a rate that cannot be checked is the thing this module exists to
     * refuse. Fewer than two is a wiring mistake and fails at construction.
     */
    sources: RateSource[];

    log?: Logger;

    /** Injected for tests, which need to walk past GRACE_MS without waiting a quarter of an hour. */
    now?: () => number;
}

export function createTetherRate(options: TetherRateOptions): TetherRate {
    const { sources, log } = options;
    const now = options.now ?? ((): number => Date.now());

    if (sources.length < 2) {
        throw new Error('createTetherRate needs at least two sources to cross-check');
    }

    let agreed: { toman: number; at: number } | null = null;
    let readings: RateReading[] = [];
    let spreadPercent: number | null = null;
    let reason = 'هنوز نرخی خوانده نشده است';
    let healthy = false;
    let inFlight: Promise<void> | null = null;

    /** @internal Records a refusal once, not once a minute, and keeps the reason for the console. */
    function fail(why: string): void {
        reason = why;
        if (healthy) {
            healthy = false;
            log?.error({ reason: why }, 'tether rate refused - selling on the last agreed rate');
        }
    }

    async function refreshOnce(): Promise<void> {
        readings = await Promise.all(sources.map((source) => source.read()));
        spreadPercent = null;

        const refused = readings.filter((reading) => reading.toman === null);
        if (refused.length > 0) {
            // Naming the sources matters: "wallex: no answer" is something an operator can
            // act on, "rate unavailable" is not.
            fail(refused.map((reading) => `${reading.name}: ${reading.reason}`).join(' / '));
            return;
        }

        const prices = readings.map((reading) => reading.toman ?? 0);
        const low = Math.min(...prices);
        const high = Math.max(...prices);
        spreadPercent = ((high - low) / low) * 100;

        if (spreadPercent > MAX_SPREAD_PERCENT) {
            fail(
                `اختلاف نرخ منابع ${spreadPercent.toFixed(1)}٪ است ` +
                    `(بیشتر از ${MAX_SPREAD_PERCENT}٪ مجاز)`
            );
            return;
        }

        // Rule 2: the cheaper of two readings that already agree.
        agreed = { toman: low, at: now() };
        reason = '';
        if (!healthy) {
            healthy = true;
            log?.info(
                { toman: low, spread: Number(spreadPercent.toFixed(2)) },
                'tether rate agreed'
            );
        }
    }

    function snapshot(): RateSnapshot | null {
        if (agreed === null) {
            return null;
        }
        const age = now() - agreed.at;
        if (age > GRACE_MS) {
            // Rule 3. It is not a price any more, so nothing is returned that could be
            // mistaken for one.
            return null;
        }
        return {
            toman: agreed.toman,
            at: new Date(agreed.at).toISOString(),
            stale: age > STALE_AFTER_MS
        };
    }

    return {
        current: snapshot,

        status(): RateStatus {
            const rate = snapshot();
            return {
                rate,
                selling: rate !== null,
                reason:
                    rate === null && agreed !== null && reason === ''
                        ? 'نرخ تتر کهنه شده است'
                        : reason,
                ageSeconds: agreed === null ? null : Math.round((now() - agreed.at) / 1000),
                readings,
                spreadPercent
            };
        },

        refresh(): Promise<void> {
            // A slow exchange must not let a second refresh stack on the first: the console's
            // "refresh now" and the timer can land together.
            inFlight ??= refreshOnce().finally(() => {
                inFlight = null;
            });
            return inFlight;
        },

        start(): () => void {
            const timer = setInterval(() => void this.refresh(), REFRESH_MS);
            // The listening socket keeps the process alive; this timer should not be the
            // reason a shutting-down process lingers.
            timer.unref();
            return (): void => clearInterval(timer);
        }
    };
}
