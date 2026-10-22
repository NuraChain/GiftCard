// The console sign-in's lockout, driven by a hand-moved clock so a day of it costs no time.
import { describe, expect, it } from 'vitest';

import { createAdmin } from '../src/features/console/session.ts';
import { TooManyRequestsError, UnauthorizedError } from '../src/platform/http.ts';

const MINUTE = 60 * 1000;

function admin(): { signIn: (key: string) => unknown; advance: (ms: number) => void } {
    let now = 1_000_000;
    const subject = createAdmin({
        matches: (candidate) => candidate === 'GOOD',
        secureCookie: false,
        now: () => now
    });
    return {
        signIn: (key) => subject.signIn('203.0.113.9', key),
        advance: (ms) => {
            now += ms;
        }
    };
}

/** Five wrong keys - one full lockout. */
function strikeOut(subject: ReturnType<typeof admin>): void {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(() => subject.signIn('BAD')).toThrow(UnauthorizedError);
    }
    expect(() => subject.signIn('BAD')).toThrow(TooManyRequestsError);
}

describe('the console sign-in lockout', () => {
    it('locks an address out for fifteen minutes after five wrong keys', () => {
        const subject = admin();
        strikeOut(subject);

        // Even the right key is refused while locked: otherwise the lockout only slows wrong guesses.
        subject.advance(14 * MINUTE);
        expect(() => subject.signIn('GOOD')).toThrow(TooManyRequestsError);

        subject.advance(2 * MINUTE);
        expect(subject.signIn('GOOD')).toMatchObject({ name: 'ashbringer_session' });
    });

    it('doubles the lockout for an address that keeps coming back', () => {
        const subject = admin();
        strikeOut(subject);
        subject.advance(16 * MINUTE);

        strikeOut(subject);
        subject.advance(16 * MINUTE);
        // The second lockout is thirty minutes, not fifteen.
        expect(() => subject.signIn('GOOD')).toThrow(TooManyRequestsError);
        subject.advance(15 * MINUTE);
        expect(subject.signIn('GOOD')).toMatchObject({ name: 'ashbringer_session' });
    });

    it('starts over after a successful sign-in', () => {
        const subject = admin();
        strikeOut(subject);
        subject.advance(16 * MINUTE);
        subject.signIn('GOOD');

        strikeOut(subject);
        subject.advance(16 * MINUTE);
        expect(subject.signIn('GOOD')).toMatchObject({ name: 'ashbringer_session' });
    });

    it('never locks for longer than a day', () => {
        const subject = admin();
        // 15, 30, 60 ... minutes, each waited out exactly - until the ninth would be 64 hours.
        for (let round = 0; round < 9; round += 1) {
            strikeOut(subject);
            subject.advance(Math.min(15 * 2 ** round, 24 * 60) * MINUTE + 1);
        }
        expect(subject.signIn('GOOD')).toMatchObject({ name: 'ashbringer_session' });
    });
});
