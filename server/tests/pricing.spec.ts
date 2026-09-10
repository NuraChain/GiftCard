// The price formula on its own, away from HTTP.
//
// `tomanPrice` is the only place a card price is produced, so these are the tests that decide
// what every buyer pays. They are unit tests rather than integration ones because the
// arithmetic has nothing to do with a request: given a denomination, a rate and a margin
// there is exactly one right answer, and it should be readable without a server.
import { describe, it, expect } from 'vitest';

import { PRICE_STEP_TOMAN, tomanPrice } from '../src/domain/pricing.ts';

describe('the price formula', () => {
    it('multiplies the denomination by the rate', () => {
        // No margin, a round rate: the price is the plain product and nothing else.
        expect(tomanPrice(10, 100_000, 0)).toBe(1_000_000);
        expect(tomanPrice(25, 100_000, 0)).toBe(2_500_000);
    });

    it('adds the margin on top of the whole card, not per dollar', () => {
        // 10 x 100,000 = 1,000,000, plus 6% = 1,060,000. The margin is a property of the
        // sale, so it applies once to the total rather than to each dollar in turn.
        expect(tomanPrice(10, 100_000, 6)).toBe(1_060_000);
    });

    it('rounds UP to the nearest thousand, never down', () => {
        // 5 x 123,456 = 617,280, plus 6% = 654,316.8. Rounding down would give away 316
        // Toman of a margin that was chosen deliberately - and it would do it on every
        // single sale.
        const price = tomanPrice(5, 123_456, 6);
        expect(price).toBe(655_000);
        expect(price % PRICE_STEP_TOMAN).toBe(0);
        expect(price).toBeGreaterThan(654_316);
    });

    it('leaves a price that already lands on a thousand alone', () => {
        // Rounding up must not mean "always add a thousand": an exact figure is exact.
        expect(tomanPrice(10, 100_000, 6) % PRICE_STEP_TOMAN).toBe(0);
        expect(tomanPrice(10, 100_000, 6)).toBe(1_060_000);
    });

    it('moves every price when the rate moves', () => {
        const before = tomanPrice(10, 100_000, 6);
        const after = tomanPrice(10, 120_000, 6);
        expect(after).toBeGreaterThan(before);
        expect(after).toBe(1_272_000);
    });

    it('refuses to invent a price from a broken input', () => {
        // A NaN rate produces a NaN price, which is a number-shaped thing that a buyer could
        // be charged. Throwing means a 500 the operator sees, rather than a card priced at
        // nothing that somebody quietly buys out.
        expect(() => tomanPrice(10, Number.NaN, 6)).toThrow(/positive/);
        expect(() => tomanPrice(10, 0, 6)).toThrow(/positive/);
        expect(() => tomanPrice(10, -100_000, 6)).toThrow(/positive/);
        expect(() => tomanPrice(0, 100_000, 6)).toThrow(/positive/);
        expect(() => tomanPrice(10, 100_000, Number.NaN)).toThrow(/margin/);
        expect(() => tomanPrice(10, 100_000, -5)).toThrow(/margin/);
    });
});
