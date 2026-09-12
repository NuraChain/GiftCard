// Admin access: one key, one cookie.
//
// WHAT THIS IS, said plainly: a shared bearer credential. Whoever holds the key is the
// admin, and there is no second factor and no per-person attribution in the ledger. Treat it
// exactly like a root password.
//
// What it does do, because the shape allows it:
//   - the key never lives here: `matches` is owned by `settings.ts`, which compares against a
//     scrypt hash in the database and falls back to the environment key until one is rotated,
//     so a stolen database yields a hash and a rotation needs no restart;
//   - attempts are locked out per client address, so 80 bits of key are not brute-forced
//     online;
//   - the browser holds an opaque session id in an HttpOnly cookie, never the key itself,
//     so no script on the page can read the credential and no history entry contains it;
//   - the key never appears in a response body, a URL, or a log line.
//
// NOTHING HTTP IS IMPORTED HERE. This module takes a client address and a session id as
// plain strings and hands back cookie instructions; the route does the reading and the
// setting. That is what lets the lockout be tested without a request object, and it is why
// swapping the HTTP layer under it changed nothing in this file but its edges.
import { TooManyRequestsError, UnauthorizedError } from '../../platform/http.ts';

/** The published shape: four groups of four, over the no-I/O/0/1 alphabet (~80 bits). */
export const ADMIN_KEY_PATTERN =
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/;

/** The cookie the browser carries. Read by the admin guard, written by the two session routes. */
export const SESSION_COOKIE = 'ashbringer_session';

const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** How often the expiry sweep may actually run. See {@link createAdmin}'s `sweep`. */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** What the route needs in order to set the cookie. Deliberately not a framework type. */
export interface CookieInstruction {
    name: string;
    value: string;
    options: {
        httpOnly: boolean;
        sameSite: 'strict';
        secure: boolean;
        path: string;
        maxAge?: number;
    };
}

export interface AdminOptions {
    /**
     * Decides whether a candidate key is THE key. Owned by `settings.ts`, which prefers the
     * rotated hash in the database and falls back to the environment key when none exists -
     * so this file never holds a credential and a rotation needs no restart.
     */
    matches(candidate: string): boolean;

    /**
     * Adds `Secure` to the session cookie.
     *
     * This is CONFIGURED rather than inferred, because nginx terminates TLS: the request
     * this process sees is plain http even when the browser is on https, so asking the
     * request would answer "no" on every production deployment.
     */
    secureCookie: boolean;
}

export interface Admin {
    /** Verifies the key and returns the cookie to set, or throws (wrong key / locked out). */
    signIn(clientAddress: string, key: string): CookieInstruction;

    /** Invalidates the given session and returns the cookie that clears it. */
    signOut(sessionId: string | undefined): CookieInstruction;

    /** Ends EVERY session. A key rotation that leaves the old holder signed in rotated nothing. */
    signOutAll(): void;

    /** Throws {@link UnauthorizedError} unless the id names a live session. */
    require(sessionId: string | undefined): void;
}

export function createAdmin(options: AdminOptions): Admin {
    // Sessions live in memory on purpose: a restart signs every admin out, which is the
    // safe direction to fail, and it keeps a live credential out of the database file.
    const sessions = new Map<string, number>();
    const attempts = new Map<string, { count: number; until: number }>();

    /**
     * @internal Drops what has expired from BOTH maps, at most once a minute.
     *
     * Two bugs live here, and the throttle is the second one's fix.
     *
     * `attempts` was originally cleared only for a bucket that went on to sign in
     * successfully, so a failed attempt from an address that never came back stayed for the
     * process lifetime. The key is the client address, so an attacker rotating source
     * addresses grew it without bound - a memory leak on the one path whose whole job is to
     * resist an attacker.
     *
     * Sweeping on EVERY call fixed that and introduced something worse: the sweep is O(n)
     * over the map, so a large map made every sign-in slower, which is a CPU exhaustion the
     * same attacker controls. Measured at 200,000 distinct addresses it took minutes. The
     * gate makes it amortised O(1), which is what the rate store next door does for the
     * same reason.
     */
    let nextSweep = 0;
    function sweep(now: number): void {
        if (now < nextSweep) {
            return;
        }
        nextSweep = now + SWEEP_INTERVAL_MS;
        for (const [id, expiresAt] of sessions) {
            if (expiresAt <= now) {
                sessions.delete(id);
            }
        }
        for (const [bucket, record] of attempts) {
            if (record.until <= now) {
                attempts.delete(bucket);
            }
        }
    }

    const clearing = (): CookieInstruction => ({
        name: SESSION_COOKIE,
        value: '',
        options: {
            httpOnly: true,
            sameSite: 'strict',
            secure: options.secureCookie,
            path: '/',
            maxAge: 0
        }
    });

    return {
        signIn(clientAddress, key) {
            const now = Date.now();
            const bucketKey = clientAddress === '' ? 'unknown' : clientAddress;
            const bucket = attempts.get(bucketKey);
            if (bucket !== undefined && bucket.until > now && bucket.count >= ATTEMPT_LIMIT) {
                throw new TooManyRequestsError(Math.ceil((bucket.until - now) / 1000));
            }

            sweep(now);

            if (!options.matches(key)) {
                const next =
                    bucket !== undefined && bucket.until > now
                        ? { count: bucket.count + 1, until: bucket.until }
                        : { count: 1, until: now + ATTEMPT_WINDOW_MS };
                attempts.set(bucketKey, next);
                // One message for every failure. Saying which part was wrong, or whether a
                // key exists at all, would hand an attacker the only feedback they lack.
                throw new UnauthorizedError('کلید نادرست است');
            }

            attempts.delete(bucketKey);

            const id = crypto.randomUUID();
            sessions.set(id, now + SESSION_MS);
            return {
                name: SESSION_COOKIE,
                value: id,
                options: {
                    httpOnly: true,
                    sameSite: 'strict',
                    secure: options.secureCookie,
                    path: '/',
                    maxAge: Math.floor(SESSION_MS / 1000)
                }
            };
        },

        signOut(sessionId) {
            if (sessionId !== undefined) {
                sessions.delete(sessionId);
            }
            return clearing();
        },

        signOutAll() {
            sessions.clear();
        },

        require(sessionId) {
            const now = Date.now();
            sweep(now);
            const expiresAt = sessionId === undefined ? undefined : sessions.get(sessionId);
            if (expiresAt === undefined || expiresAt <= now) {
                throw new UnauthorizedError('برای این بخش باید وارد شوید');
            }
        }
    };
}
