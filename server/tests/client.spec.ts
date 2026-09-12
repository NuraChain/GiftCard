// Serving the built client at `/`, and the line between a page and an API call.
//
// WHY THIS IS TESTED RATHER THAN TRUSTED. The failure it prevents is a whole site answering
// `{"error":{"code":"not-found"}}` on every page - which looks like a broken application and
// is actually a proxy forwarding `/` to an API that only ever had `/api`. That is a confusing
// enough failure to be worth pinning down, in both directions: pages must fall back to the
// document, and /api must keep refusing in JSON no matter what.
//
// The fixture is a REAL directory on disk with a real index.html, because what is under test
// is partly the filesystem: whether the file is found, and what happens when it is not.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../src/app.ts';
import { createAdmin } from '../src/features/console/session.ts';
import { createSettings } from '../src/features/settings/settings.ts';
import { createStore, type Store } from '../src/db/index.ts';
import type { TetherRate } from '../src/features/rate/rate.ts';

const DOCUMENT = '<!doctype html><html lang="fa"><body><div id="root"></div></body></html>';
const BUNDLE = 'console.log("hello");';

/** Everything buildApp needs that this file does not care about. */
function stubs(store: Store) {
    const rate: TetherRate = {
        current: () => null,
        status: () => ({ rate: null, selling: false, reason: 'no rate', ageSeconds: null })
    };
    return {
        store,
        rate,
        settings: createSettings({ store }),
        payment: {
            request: () => Promise.resolve({ ok: false as const, reason: 'not used' }),
            verify: () => Promise.resolve({ ok: false as const, reason: 'not used' })
        },
        mailer: { sendCode: () => Promise.resolve({ ok: true as const }) },
        telegram: {
            configured: () => false,
            sendMessage: () => Promise.resolve({ ok: true as const }),
            sendDocument: () => Promise.resolve({ ok: true as const }),
            receive: () => Promise.resolve([])
        },
        notifier: { sold: (): void => {} },
        backup: {
            runNow: () => Promise.resolve({ ok: true as const }),
            start: () => (): void => {}
        },
        payouts: { redeemed: () => Promise.resolve({ ok: true as const }) },
        admin: createAdmin({ matches: () => false, secureCookie: false })
    };
}

let store: Store;
let dist: string;

beforeEach(() => {
    store = createStore(':memory:');
    dist = mkdtempSync(join(tmpdir(), 'ashbringer-dist-'));
});

afterEach(() => {
    store.close();
    rmSync(dist, { recursive: true, force: true });
});

/** A directory shaped the way `vite build` leaves one. */
function build(): void {
    writeFileSync(join(dist, 'index.html'), DOCUMENT);
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), BUNDLE);
}

describe('serving the built client', () => {
    it('answers the document at the root', async () => {
        build();
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const response = await app.inject({ method: 'GET', url: '/' });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('id="root"');
        // The document names the hashed bundles, so a cached copy points at files the next
        // deploy deletes - and the site breaks for whoever visited most recently.
        expect(response.headers['cache-control']).toBe('no-store');
        await app.close();
    });

    it('hands the SAME document to a router path that is not a file', async () => {
        // `/admin/orders` exists in the client's route table and nowhere on disk. Without
        // this fallback a refresh anywhere but `/` is a 404.
        build();
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const response = await app.inject({ method: 'GET', url: '/admin/orders' });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('id="root"');
        await app.close();
    });

    it('serves a real asset as itself, cached hard', async () => {
        build();
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(BUNDLE);
        // Safe precisely because the name contains the hash: different content, different URL.
        expect(response.headers['cache-control']).toContain('immutable');
        await app.close();
    });

    it('caches a hashed bundle for a year and an unhashed icon for a day', async () => {
        // TWO KINDS OF FILE, two rules. `/assets/index-abc123.js` carries its content hash in
        // its name, so a year of immutable is what the hash is FOR. `favicon-32.png` keeps
        // its name forever - cache that for a year and a new logo reaches nobody who has
        // already visited the site.
        build();
        writeFileSync(join(dist, 'favicon-32.png'), 'not really a png');
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const bundle = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
        const icon = await app.inject({ method: 'GET', url: '/favicon-32.png' });

        expect(bundle.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(icon.headers['cache-control']).toBe('public, max-age=86400');
        await app.close();
    });

    it('STILL REFUSES AN UNKNOWN /api PATH IN JSON', async () => {
        // The line this whole file is about. A client call to a route that does not exist
        // must not be answered with an HTML document - the caller parses JSON, and a page
        // would surface as an unreadable parse error instead of a 404.
        build();
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const response = await app.inject({ method: 'GET', url: '/api/nope' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
            error: { code: 'not-found', message: 'این آدرس وجود ندارد' }
        });
        await app.close();
    });

    it('does not answer a POST to a missing page with a document', async () => {
        // A form posting to a path that does not exist is a mistake, not navigation. Only
        // GET and HEAD get the single-page fallback.
        build();
        const app = buildApp({ ...stubs(store), clientDir: dist });

        const response = await app.inject({ method: 'POST', url: '/whatever' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ error: { code: 'not-found' } });
        await app.close();
    });

    it('runs as a JSON-only API when there is no build, rather than failing to start', async () => {
        // The directory exists and is EMPTY - somebody deployed without running the build.
        // The half that moves money must not refuse to boot over a missing stylesheet.
        const app = buildApp({ ...stubs(store), clientDir: dist });

        expect((await app.inject({ method: 'GET', url: '/api/healthz' })).statusCode).toBe(200);

        const page = await app.inject({ method: 'GET', url: '/' });
        expect(page.statusCode).toBe(404);
        expect(page.json()).toMatchObject({ error: { code: 'not-found' } });
        await app.close();
    });

    it('serves nothing at all when no directory is configured', async () => {
        // What every other test in this suite runs as, and what an nginx deployment wants.
        const app = buildApp(stubs(store));

        expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/api/healthz' })).statusCode).toBe(200);
        await app.close();
    });

    it('will not serve a file from outside the build directory', async () => {
        // A traversal out of the served root reaches the database, the logs and server/.env.
        // @fastify/static refuses it; this is here so that stays true if it is ever replaced.
        build();
        writeFileSync(join(dist, '..', 'ashbringer-secret.txt'), 'the merchant id');
        const app = buildApp({ ...stubs(store), clientDir: dist });

        for (const url of [
            '/../ashbringer-secret.txt',
            '/..%2fashbringer-secret.txt',
            '/assets/../../ashbringer-secret.txt'
        ]) {
            const response = await app.inject({ method: 'GET', url });
            expect(response.body).not.toContain('the merchant id');
        }

        rmSync(join(dist, '..', 'ashbringer-secret.txt'), { force: true });
        await app.close();
    });
});
