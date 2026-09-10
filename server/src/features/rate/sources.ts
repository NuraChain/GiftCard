// The two exchanges the tether rate is read from, and the reason there are two.
//
// ONE EXCHANGE IS NOT A PRICE, IT IS AN OPINION. If the only source we ask answers with a
// number that is wrong - stale, mispriced during a halt, or simply a different unit after a
// quiet API change - the shop prices every card off it and nobody finds out until the day's
// takings are counted. Two independent sources that have to AGREE turn that from a silent
// loss into a refusal, which is the whole design of ./rate.ts.
//
// THE UNITS ARE NOT THE SAME, and that is exactly the trap this file exists to close.
// Nobitex quotes its Toman markets in RIALS - `USDTIRT` returns 1,234,500 for a 123,450
// Toman tether. Wallex quotes `USDTTMN` in TOMAN. Each source converts to Toman itself and
// says so at the point of conversion, so the cross-check in rate.ts compares like with like.
// If either provider ever changes that quietly, the two stop agreeing by a factor of ten and
// the shop closes rather than selling dollars at a tenth of their price.
//
// `fetch` is INJECTED the same way the gateway and the SMS client take it: it is what lets
// every path here - a timeout, a 500, a string that will not parse, a plausible-looking
// number that is off by 10x - be tested without a network.
import type { Fetch } from '../checkout/zarinpal.ts';

/**
 * A LOOSE backstop, not a validation. One tether has cost between roughly five thousand and
 * two hundred thousand Toman across this shop's lifetime, and the band below is wide enough
 * to survive a decade of that without an edit.
 *
 * It is deliberately not tight: making it tight would mean editing this file every time the
 * Toman moves, and a band that has to be maintained is a band that will be wrong. The real
 * defence against a bad number is the cross-check in rate.ts. This only catches the answers
 * that are not prices at all - a zero, a negative, an error code parsed as a figure.
 */
const MIN_PLAUSIBLE_TOMAN = 1_000;
const MAX_PLAUSIBLE_TOMAN = 100_000_000;

/** What one source answered. `toman` is null when the reading cannot be used, and why. */
export interface RateReading {
    /** The source's name, as the console shows it. */
    name: string;

    /** One USDT in TOMAN - never rials, whatever the provider quoted in. */
    toman: number | null;

    /** Empty when the reading is good; otherwise what went wrong, for the console. */
    reason: string;
}

/** One exchange, asked the same question. */
export interface RateSource {
    readonly name: string;
    read(): Promise<RateReading>;
}

export interface SourceOptions {
    /** Read PER CALL: the host is a console setting, so a client built at boot would go stale. */
    baseUrl: () => string;

    fetch?: Fetch;

    /** A rate provider that hangs must not hold up the refresh - the other source can still answer. */
    timeoutMs?: number;
}

/**
 * Nobitex. `lastTradePrice` on the USDTIRT order book, quoted in RIALS.
 *
 * The order book is used rather than the stats endpoint because it is the narrower call: one
 * market, one number, and nothing to pick out of a map of every pair the exchange lists.
 */
export function nobitexSource(options: SourceOptions): RateSource {
    return {
        name: 'nobitex',
        async read(): Promise<RateReading> {
            const body = await getJson(options, '/v2/orderbook/USDTIRT');
            if (body === null) {
                return { name: 'nobitex', toman: null, reason: 'no answer' };
            }
            // Rials to Toman. The one line in this file that would silently cost the shop
            // 90% of every sale if it were dropped.
            const rials = asNumber(readPath(body, ['lastTradePrice']));
            return finish('nobitex', rials === null ? null : rials / 10);
        }
    };
}

/**
 * Wallex. `lastPrice` on the USDTTMN market, already quoted in TOMAN.
 *
 * This one does return a map of every market, so the symbol is read by name - a missing
 * `USDTTMN` is a reading failure rather than a silent undefined turned into NaN.
 */
export function wallexSource(options: SourceOptions): RateSource {
    return {
        name: 'wallex',
        async read(): Promise<RateReading> {
            const body = await getJson(options, '/v1/markets');
            if (body === null) {
                return { name: 'wallex', toman: null, reason: 'no answer' };
            }
            const toman = asNumber(
                readPath(body, ['result', 'symbols', 'USDTTMN', 'stats', 'lastPrice'])
            );
            return finish('wallex', toman);
        }
    };
}

/** @internal One GET, with a timeout, that never throws. Null means "no usable answer". */
async function getJson(options: SourceOptions, path: string): Promise<unknown> {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    try {
        const response = await call(`${options.baseUrl()}${path}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(options.timeoutMs ?? 8_000)
        });
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch {
        // A timeout, a DNS failure, a body that is not JSON: indistinguishable from here and
        // all the same thing to the caller - this source did not answer.
        return null;
    }
}

/** @internal Walks a path through parsed JSON without trusting a single step of it. */
function readPath(body: unknown, path: string[]): unknown {
    let node = body;
    for (const key of path) {
        if (typeof node !== 'object' || node === null) {
            return undefined;
        }
        node = (node as Record<string, unknown>)[key];
    }
    return node;
}

/**
 * @internal Both exchanges quote prices as STRINGS. `Number('')` is 0 and `Number(null)` is
 * 0, either of which would sail through a `> 0` check somewhere downstream, so the empty and
 * non-string cases are rejected here rather than converted.
 */
function asNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** @internal The last gate every reading passes through: plausible, or refused with a reason. */
function finish(name: string, toman: number | null): RateReading {
    if (toman === null) {
        return { name, toman: null, reason: 'no price in the answer' };
    }
    if (toman < MIN_PLAUSIBLE_TOMAN || toman > MAX_PLAUSIBLE_TOMAN) {
        return { name, toman: null, reason: `price out of range (${Math.round(toman)})` };
    }
    return { name, toman: Math.round(toman), reason: '' };
}
