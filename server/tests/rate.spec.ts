// What the shop does with a rate somebody typed by hand, tested one state at a time.
//
// The stored value and the clock are both injected, so every path here - a rate set and
// selling, a rate old enough to warn about, a shop with no rate at all, a row someone edited
// into the database badly - runs in microseconds against no network and no file. That matters
// more than usual: these are the paths that only happen when something is already wrong or
// nothing has been configured yet, which is exactly when nobody is watching.
//
// TWO RULES CARRY THE WHOLE FILE, and they pull in opposite directions on purpose:
//   - an unusable rate CLOSES the shop, because there is no safe number to substitute;
//   - an OLD rate does not, because nothing is coming to refresh it and a shop that shuts
//     itself overnight cannot be reopened by an operator who is asleep.
import { describe, it, expect } from 'vitest';

import { createTetherRate, STALE_AFTER_MS } from '../src/features/rate/rate.ts';

/** A clock the test moves by hand, so a six-hour window costs no wall time. */
function clock(): { now: () => number; advance: (ms: number) => void } {
    let value = Date.UTC(2026, 0, 1);
    return {
        now: () => value,
        advance: (ms) => {
            value += ms;
        }
    };
}

/** The console's stored rate, as `settings.current()` would hand it over. */
function stored(toman: number, setAt: string): () => { tetherToman: number; tetherSetAt: string } {
    return () => ({ tetherToman: toman, tetherSetAt: setAt });
}

describe('the tether rate', () => {
    it('prices with the number the console set', () => {
        const time = clock();
        const rate = createTetherRate({
            settings: stored(123_450, new Date(time.now()).toISOString()),
            now: time.now
        });

        expect(rate.current()?.toman).toBe(123_450);
        expect(rate.current()?.stale).toBe(false);
        expect(rate.status().selling).toBe(true);
        expect(rate.status().reason).toBe('');
        expect(rate.status().ageSeconds).toBe(0);
    });

    it('closes the shop when no rate has ever been set', () => {
        const rate = createTetherRate({ settings: stored(0, '') });

        // Not a zero price and not a fallback - nothing is sellable, and the console is told
        // in words an operator can act on.
        expect(rate.current()).toBeNull();
        expect(rate.status().selling).toBe(false);
        expect(rate.status().reason).toContain('تنظیم نشده');
        expect(rate.status().ageSeconds).toBeNull();
    });

    it('picks up a new rate on the very next read', () => {
        // No timer, no refresh, no cache: the console writes a setting and the next request
        // is priced with it. This is the behaviour that replaced the refresh loop.
        let toman = 100_000;
        const rate = createTetherRate({
            settings: () => ({ tetherToman: toman, tetherSetAt: new Date().toISOString() })
        });

        expect(rate.current()?.toman).toBe(100_000);
        toman = 140_000;
        expect(rate.current()?.toman).toBe(140_000);
    });

    it('marks a rate stale once it outlives a working day of drift', () => {
        const time = clock();
        const setAt = new Date(time.now()).toISOString();
        const rate = createTetherRate({ settings: stored(123_450, setAt), now: time.now });

        expect(rate.current()?.stale).toBe(false);

        time.advance(STALE_AFTER_MS + 1_000);

        expect(rate.current()?.stale).toBe(true);
        expect(rate.current()?.toman).toBe(123_450);
    });

    it('KEEPS SELLING on a stale rate rather than shutting itself overnight', () => {
        // The deliberate difference from the old cross-checked rate, which expired after
        // fifteen minutes because a refresh was on its way to replace it. Nothing refreshes
        // this one, so expiring it would shut the shop with no way back. The warning is the
        // remedy, not the closure.
        const time = clock();
        const rate = createTetherRate({
            settings: stored(123_450, new Date(time.now()).toISOString()),
            now: time.now
        });

        time.advance(STALE_AFTER_MS * 20);

        expect(rate.status().selling).toBe(true);
        expect(rate.current()?.stale).toBe(true);
        expect(rate.status().ageSeconds).toBe(Math.round((STALE_AFTER_MS * 20) / 1000));
    });

    it('refuses a rate whose timestamp cannot be read', () => {
        // `save` writes the number and its stamp together, so this is a hand-edited database.
        // The age is part of the price - a number the ticker cannot date is one it would have
        // to lie about - so it is refused rather than shown as fresh.
        const rate = createTetherRate({ settings: stored(123_450, 'not-a-date') });

        expect(rate.current()).toBeNull();
        expect(rate.status().selling).toBe(false);
        expect(rate.status().reason).toContain('معتبر نیست');
    });

    it('refuses a rate outside the fat-finger band', () => {
        // settings.ts already zeroes these on the way out; this proves rate.ts does not price
        // with one either if a value ever reaches it another way. An extra zero on the rate is
        // ten times the money on every card at once.
        const at = new Date().toISOString();

        expect(createTetherRate({ settings: stored(12, at) }).current()).toBeNull();
        expect(createTetherRate({ settings: stored(999_999_999, at) }).current()).toBeNull();
    });
});
