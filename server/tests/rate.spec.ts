// The three rules that decide whether this shop is open, tested one at a time.
//
// The sources are fakes and the clock is injected, so every path here - two exchanges
// agreeing, one going silent, the two disagreeing wildly, a rate ageing past its grace
// window - runs in microseconds against no network at all. That matters more than usual:
// these are the paths that only ever happen when something is already going wrong, which is
// exactly when nobody is watching.
import { describe, it, expect } from 'vitest';

import { createTetherRate, GRACE_MS, MAX_SPREAD_PERCENT } from '../src/features/rate/rate.ts';
import type { RateSource } from '../src/features/rate/sources.ts';

/** An exchange that answers whatever the test last put in it. */
function source(name: string, toman: number | null): RateSource & { toman: number | null } {
    const fake = {
        name,
        toman,
        read: () =>
            Promise.resolve({
                name,
                toman: fake.toman,
                reason: fake.toman === null ? 'no answer' : ''
            })
    };
    return fake;
}

/** A clock the test moves by hand, so a fifteen-minute window costs no wall time. */
function clock(): { now: () => number; advance: (ms: number) => void } {
    let value = Date.UTC(2026, 0, 1);
    return {
        now: () => value,
        advance: (ms) => {
            value += ms;
        }
    };
}

describe('the tether rate', () => {
    it('agrees a rate when two exchanges are close, and takes the lower', async () => {
        const time = clock();
        const rate = createTetherRate({
            sources: [source('a', 123_900), source('b', 123_450)],
            now: time.now
        });

        await rate.refresh();

        // Within the allowed spread, so the cheaper reading is used - the gap is covered by
        // the margin and it falls on the side of the buyer paying less.
        expect(rate.current()?.toman).toBe(123_450);
        expect(rate.status().selling).toBe(true);
    });

    it('refuses a rate when the two exchanges disagree', async () => {
        const time = clock();
        const rate = createTetherRate({
            sources: [source('a', 123_450), source('b', 98_000)],
            now: time.now
        });

        await rate.refresh();

        // 20% apart means one of them is broken and nothing here can tell which. Picking a
        // side would be guessing with somebody's money.
        expect(rate.current()).toBeNull();
        expect(rate.status().selling).toBe(false);
        expect(rate.status().spreadPercent).toBeGreaterThan(MAX_SPREAD_PERCENT);
    });

    it('refuses a rate when only one exchange answers', async () => {
        const time = clock();
        const rate = createTetherRate({
            sources: [source('a', 123_450), source('b', null)],
            now: time.now
        });

        await rate.refresh();

        // One answer is not a quorum. The whole reason for asking twice is that a single
        // reading cannot be checked against anything.
        expect(rate.current()).toBeNull();
        expect(rate.status().reason).toContain('b');
    });

    it('keeps selling on the last agreed rate while the grace window lasts', async () => {
        const time = clock();
        const good = source('a', 123_450);
        const other = source('b', 123_500);
        const rate = createTetherRate({ sources: [good, other], now: time.now });

        await rate.refresh();
        expect(rate.current()?.toman).toBe(123_450);

        // Both exchanges go dark. A blip must not close a shop.
        good.toman = null;
        other.toman = null;
        time.advance(60_000);
        await rate.refresh();

        expect(rate.current()?.toman).toBe(123_450);
        expect(rate.status().selling).toBe(true);
    });

    it('marks a rate stale before it stops honouring it', async () => {
        const time = clock();
        const good = source('a', 123_450);
        const other = source('b', 123_500);
        const rate = createTetherRate({ sources: [good, other], now: time.now });

        await rate.refresh();
        expect(rate.current()?.stale).toBe(false);

        good.toman = null;
        time.advance(5 * 60_000);
        await rate.refresh();

        // Still sellable, but the shop says so rather than passing an old number off as
        // current - the ticker turns amber on exactly this flag.
        expect(rate.current()?.stale).toBe(true);
        expect(rate.status().selling).toBe(true);
    });

    it('stops selling once the last agreed rate outlives its grace window', async () => {
        const time = clock();
        const good = source('a', 123_450);
        const other = source('b', 123_500);
        const rate = createTetherRate({ sources: [good, other], now: time.now });

        await rate.refresh();
        good.toman = null;
        other.toman = null;

        time.advance(GRACE_MS + 1_000);
        await rate.refresh();

        // Past the deadline it is not a price any more, it is a memory. Returning it would
        // mean trading against a number from a different hour while the Toman moved.
        expect(rate.current()).toBeNull();
        expect(rate.status().selling).toBe(false);
    });

    it('recovers on its own once the exchanges come back', async () => {
        const time = clock();
        const good = source('a', 123_450);
        const other = source('b', null);
        const rate = createTetherRate({ sources: [good, other], now: time.now });

        await rate.refresh();
        expect(rate.current()).toBeNull();

        other.toman = 123_600;
        time.advance(60_000);
        await rate.refresh();

        // No restart, no intervention: the next agreeing pair reopens the shop.
        expect(rate.current()?.toman).toBe(123_450);
        expect(rate.status().reason).toBe('');
    });

    it('will not be built with a single source to trust', () => {
        // A one-source rate is an unchecked rate, which is the thing this module exists to
        // refuse. Catching it at construction makes it a boot failure rather than a shop
        // that looks fine and prices off one opinion.
        expect(() => createTetherRate({ sources: [source('a', 123_450)] })).toThrow(/two sources/);
    });
});
