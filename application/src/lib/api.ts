// The fully inferred API client, built from the SAME contract the server mounts
// (server/src/contract/ - one declaration, both sides). Calls are typed end to end:
// `client.pay.start({ input })` checks the input against the shared schema BEFORE the wire,
// and the response type is the contract's output type.
//
// The '/api' base is one string for both deployments on purpose: in dev vite proxies it to
// the server (vite.config.ts), and in production the reverse proxy in front does the same.
// The browser therefore only ever talks to the origin it loaded from, which is why there is
// no CORS anywhere in this repo.
import { createClient } from '../../../server/src/platform/contract.ts';
import { contract } from '../../../server/src/contract/index.ts';

export { ApiError } from '../../../server/src/platform/contract.ts';

export const client = createClient(contract, { baseUrl: '/api' });

/**
 * The message to show when a call fails.
 *
 * Every failure that crossed the wire carries Persian copy the server wrote for the reader;
 * what this guards against is the other kind - a dropped connection, a parse failure - where
 * there is no message and the raw `Error` text would be English plumbing.
 */
export function failureText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message !== '' ? error.message : fallback;
}
