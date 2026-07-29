// Per-route rate limiting, for the handful of routes where one call costs real money or is
// one guess at a credential.
import { clientIp, MemoryRateStore, TooManyRequestsError, type RequestContext } from '@azerothjs/http';

/**
 * A counter keyed on the client IP WITHOUT trusting a forwarding header - one that is
 * attacker-supplied would let a single machine mint a fresh bucket per request.
 *
 * The global edge limiter is generous because most traffic is page loads; these routes are
 * tight because each call costs money or guesses a credential.
 */
export function throttle(limit: number, windowMs: number): (context: RequestContext) => void
{
    const store = new MemoryRateStore();
    return (context) =>
    {
        const decision = store.hit(clientIp(context.request) ?? 'unknown', limit, windowMs);
        if (decision.limited)
        {
            throw new TooManyRequestsError(decision.resetSeconds);
        }
    };
}
