// The app, built pure: dependencies in, App out. WIRING ONLY.
//
// Every route lives in `features/<name>/feature.ts`, beside the rules it calls and its SQL, and
// its wire shapes sit in the `schemas.ts` next to it. Nothing in this file decides anything - it
// says which feature answers which surface, and what a request has to get past before a handler
// sees it. If a rule appears here, it is in the wrong file.
//
// Reading this file should tell you two things and nothing else: the shape of the API, and what
// is guarded.
//
// API routes live under /api - the same prefix the application's dev proxy forwards - and in
// production the server also serves the built client, so the deployed app is ONE origin (no
// CORS to configure between your own halves).
//
// Everything arrives as OPTIONS. Nothing here reads config or touches the network by itself,
// so the whole flow - including the forged-callback, replay and sold-out paths - is exercised
// by handing `buildApp` an in-memory database and two fakes.
import { App, json, type RequestContext, type RequestObserver } from '@azerothjs/http';
import { feature, manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import type { Logger } from '@azerothjs/logger';

import type { Store } from './db/index.ts';
import { catalogueRoutes } from './features/catalogue/feature.ts';
import { createCheckout } from './features/checkout/checkout.ts';
import { mountPayCallback, payFeature } from './features/checkout/feature.ts';
import type { SmsSender } from './features/checkout/sms.ts';
import type { PaymentGateway } from './features/checkout/zarinpal.ts';
import { consoleRoutes } from './features/console/feature.ts';
import type { Admin } from './features/console/session.ts';
import { inventoryRoutes } from './features/inventory/feature.ts';
import { settingsRoutes } from './features/settings/feature.ts';
import type { Settings } from './features/settings/settings.ts';

export interface AppOptions
{
    dev: boolean;
    observe?: RequestObserver;

    /** The built client + SSR renderer (production); omit in dev - vite serves the client. */
    pages?: KitOptions;

    store: Store;
    payment: PaymentGateway;
    sms: SmsSender;
    admin: Admin;

    /** Runtime configuration: credentials and hosts the console can change without a deploy. */
    settings: Settings;

    /** The absolute URL the gateway returns the buyer to. */
    callbackUrl: string;

    /** Where the buyer lands afterwards; the receipt token is appended. */
    resultPath?: string;

    log?: Logger;
}

/**
 * The whole API, in one screen: two surfaces, and the four feature files that fill the second.
 *
 * The record key is the client namespace (`client.admin.tiers()`), so the admin routes are ONE
 * feature rather than four - a feature per folder would split that namespace four ways and, more
 * to the point, would make the session guard four separate decisions instead of one.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literals ARE the type; naming it would erase per-route inference
export function createApi(options: AppOptions & { checkout: ReturnType<typeof createCheckout> })
{
    const { store, payment, sms, admin, settings, callbackUrl, checkout, log } = options;

    // A guard is any (context) => void | Response | additions. `guard()` only earns its keep when
    // the guard ADDS to the context and that addition must be inferred; this one only throws.
    const requireAdmin = (context: RequestContext): void => void admin.require(context.request);

    return {
        pay: payFeature({ store, settings, payment, checkout, callbackUrl, resultPath: options.resultPath ?? '/', log }),

        // Everything under here is behind the session by DEFAULT: a route added to any of the
        // four builders is guarded because of the feature it lands in, not because someone
        // remembered a line. The two ways out are `routes.with(...)` calls in console/feature.ts,
        // written at the route they exempt.
        admin: feature('/admin', [requireAdmin], (routes) => ({
            ...consoleRoutes(routes, { store, admin }),
            ...catalogueRoutes(routes, { store, log }),
            ...inventoryRoutes(routes, { store }),
            ...settingsRoutes(routes, { settings, admin, sms, callbackUrl, requireAdmin, log })
        }))
    };
}

export type Api = ReturnType<typeof createApi>;

export function buildApp(options: AppOptions): App
{
    const app = new App({ dev: options.dev, observe: options.observe });
    const { store, payment, sms, log } = options;

    // The orchestrator probe: cheap, dependency-free, always 200 when the process lives. It
    // stays imperative because nothing calls it with types - see features/ for the rest.
    app.get('/api/healthz', () => json({ ok: true, at: new Date().toISOString() }));

    const checkout = createCheckout({ store, payment, sms, log });
    const api = createApi({ ...options, checkout });

    register(app, api);

    // The gateway's return is a browser REDIRECT, not a typed call, so checkout mounts it
    // itself rather than through a declaration.
    mountPayCallback(app, {
        store,
        settings: options.settings,
        payment,
        checkout,
        callbackUrl: options.callbackUrl,
        resultPath: options.resultPath ?? '/',
        log
    });

    // The typed client's runtime half: method + path per route, projected from the SAME
    // declaration register just installed. The browser fetches it once at boot.
    app.get('/api/_manifest', () => json(manifestOf(api)));

    if (options.pages !== undefined)
    {
        // One origin in production: everything that is not /api is a page or an asset. The
        // kit reads the route table's per-route `render` mode, and everything else falls
        // through to the built client's assets. Mounted LAST so nothing shadows the API.
        mountPages(app, options.pages);
    }

    return app;
}
