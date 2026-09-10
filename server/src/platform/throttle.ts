// Rate limiting: one generous limiter at the edge, and tight per-route ones on the handful
// of routes where a single call costs real money or is one guess at a credential.
//
// WHERE THE CLIENT IP COMES FROM, and why that changed. This used to read the socket address
// and deliberately IGNORE `X-Forwarded-For`, because a forwarding header is attacker-supplied
// and honouring one lets a single machine mint a fresh bucket per request.
//
// This server now sits behind nginx, so the socket address is ALWAYS nginx and reading it
// would put every buyer in the world into one bucket - one attacker would lock out the whole
// shop. So Fastify's `trustProxy` is on, set to a HOP COUNT rather than `true`: it takes the
// address the last proxy recorded and ignores anything the client wrote in front of it.
// `deploy/nginx.conf` closes the other half by OVERWRITING `X-Forwarded-For` with
// `$remote_addr` rather than appending to it.
//
// Get either half wrong and the lockout below is decorative. They are documented together
// for that reason.
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Guard } from './api.ts';
import { TooManyRequestsError } from './http.ts';

interface Bucket
{
    count: number;

    /** When this bucket resets, as an epoch millisecond. */
    until: number;
}

/**
 * A fixed-window counter, kept in memory.
 *
 * The sweep is GATED to once a minute rather than run on every hit. Sweeping every call is
 * O(n) over the map, and the map's keys are client addresses - so an attacker rotating source
 * addresses would make every request slower for everybody, which is a CPU exhaustion handed
 * to the one party you least want to hand one to. The gate makes it amortised O(1).
 */
export class MemoryRateStore
{
    readonly #buckets = new Map<string, Bucket>();
    #nextSweep = 0;

    public hit(key: string, limit: number, windowMs: number): { limited: boolean; resetSeconds: number }
    {
        const now = Date.now();
        this.#sweep(now);

        const found = this.#buckets.get(key);
        const bucket = found !== undefined && found.until > now
            ? found
            : { count: 0, until: now + windowMs };

        bucket.count += 1;
        this.#buckets.set(key, bucket);

        return {
            limited: bucket.count > limit,
            resetSeconds: Math.max(1, Math.ceil((bucket.until - now) / 1000))
        };
    }

    #sweep(now: number): void
    {
        if (now < this.#nextSweep)
        {
            return;
        }
        this.#nextSweep = now + 60_000;
        for (const [key, bucket] of this.#buckets)
        {
            if (bucket.until <= now)
            {
                this.#buckets.delete(key);
            }
        }
    }
}

/**
 * A per-route limiter, as a guard.
 *
 * The edge limiter is generous because most traffic is ordinary reads; these are tight
 * because each call costs a gateway request, an SMS, or one guess at a credential.
 */
export function throttle(limit: number, windowMs: number): Guard
{
    const store = new MemoryRateStore();
    return ({ request }) =>
    {
        const decision = store.hit(request.ip, limit, windowMs);
        if (decision.limited)
        {
            throw new TooManyRequestsError(decision.resetSeconds);
        }
    };
}

/**
 * The edge limiter, as an `onRequest` hook. Everything the process serves passes through it.
 *
 * IT IS `async` FOR A REASON, and the reason is not style. Fastify decides how to continue a
 * hook by what the hook gives back: return a promise and it is awaited, otherwise it waits
 * for the `done` callback to be invoked. A plain synchronous hook that does neither never
 * finishes - the request is accepted, logged, and then hangs until the client gives up, with
 * no error anywhere to say why. `async` makes the return a promise and closes that door.
 */
export function rateLimit(limit: number, windowMs: number): (request: FastifyRequest, reply: FastifyReply) => Promise<void>
{
    const store = new MemoryRateStore();
    return async (request) =>
    {
        const decision = store.hit(request.ip, limit, windowMs);
        if (decision.limited)
        {
            throw new TooManyRequestsError(decision.resetSeconds);
        }
    };
}
