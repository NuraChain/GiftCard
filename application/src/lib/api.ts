// The one file that crosses into the server half - and it crosses with TYPES only. `Api` is
// erased at build, so no handler, store or gateway can reach the browser bundle. The client's
// runtime half is the served manifest: method + path per route, projected from the SAME
// declaration the server registered, fetched once at boot.
//
// Calls stay typed end to end: `client.pay.start({ input })` checks the input against the shared
// schema BEFORE the wire, and the response type is the route's output type. The '/api' base
// matches the dev proxy (vite.config.ts) and the production mount.
import { createClient, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../../server/src/app.ts';

/**
 * The manifest, or an empty one.
 *
 * This is a TOP-LEVEL await, so a throw here would take the whole module graph down and paint
 * nothing at all. An empty manifest instead lets every page render and fail at its own call,
 * where the shop already says "the catalogue did not load" and the console already says the
 * session ended - designed states, rather than a blank screen.
 *
 * During SSR there is no document: pages fetch in `mount { }`, which runs only in the browser,
 * so no call is ever made server-side.
 */
async function loadManifest(): Promise<Manifest>
{
    if (typeof document === 'undefined')
    {
        return {};
    }
    try
    {
        const response = await fetch('/api/_manifest');
        return response.ok ? await response.json() as Manifest : {};
    }
    catch
    {
        return {};
    }
}

export const client = createClient<Api>(await loadManifest(), { baseUrl: '/api' });
