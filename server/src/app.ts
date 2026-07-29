// The app, built pure: dependencies in, App out.
//
// This file does ONE thing now - it wires routes to handlers and says which are guarded.
// The handlers live in `routes/`, the rules they call in `services/`, the queries in `db/`.
// Reading this file should tell you the shape of the API and nothing else.
//
// API routes live under /api - the same prefix the application's dev proxy forwards - and in
// production the server also serves the built client, so the deployed app is ONE origin (no
// CORS to configure between your own halves).
//
// Everything arrives as OPTIONS. Nothing here reads config or touches the network by itself,
// so the whole flow - including the forged-callback, replay and sold-out paths - is exercised
// by handing `buildApp` an in-memory database and two fakes.
import { App, json, type RequestObserver } from '@azerothjs/http';
import { guard, mountApi } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import type { Logger } from '@azerothjs/logger';

import { contract } from './contract.ts';
import type { Store } from './db/index.ts';
import type { SmsSender } from './gateways/kavenegar.ts';
import type { PaymentGateway } from './gateways/zarinpal.ts';
import { adminHandlers } from './routes/admin.ts';
import { mountPayCallback, payHandlers } from './routes/pay.ts';
import { throttle } from './routes/throttle.ts';
import type { Admin } from './services/admin.ts';
import { createCheckout } from './services/checkout.ts';
import type { Settings } from './services/settings.ts';

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

export function buildApp(options: AppOptions): App
{
    const app = new App({ dev: options.dev, observe: options.observe });
    const { store, payment, sms, admin, settings, callbackUrl, log } = options;
    const resultPath = options.resultPath ?? '/';

    // The orchestrator probe: cheap, dependency-free, always 200 when the process lives.
    app.get('/api/healthz', () => json({ ok: true, at: new Date().toISOString() }));

    const checkout = createCheckout({ store, payment, sms, log });
    const pay = { store, settings, payment, checkout, callbackUrl, resultPath, log };

    mountPayCallback(app, pay);

    const requireAdmin = guard((context) => void admin.require(context.request));

    mountApi(app, contract, {
        guards: {
            // Money or credentials: one call here costs a gateway request, an SMS, or a guess.
            'pay.start': [guard(throttle(8, 60_000))],
            'admin.signIn': [guard(throttle(10, 60_000))],

            'admin.overview': [requireAdmin],
            'admin.orders': [requireAdmin],
            'admin.addCodes': [requireAdmin],
            'admin.codes': [requireAdmin],
            'admin.tiers': [requireAdmin],
            'admin.saveTier': [requireAdmin],
            'admin.removeTier': [requireAdmin],
            'admin.settings': [requireAdmin],
            'admin.saveSettings': [requireAdmin],
            'admin.settingsLog': [requireAdmin],

            // Rotation takes the CURRENT key, so it is one more place a credential can be
            // guessed against - guarded and throttled.
            'admin.rotateKey': [requireAdmin, guard(throttle(10, 60_000))],
            'admin.testSms': [requireAdmin, guard(throttle(5, 60_000))]
        },
        handlers: {
            pay: payHandlers(pay),
            admin: adminHandlers({ store, admin, settings, sms, callbackUrl, log })
        }
    });

    if (options.pages !== undefined)
    {
        // One origin in production: everything that is not /api is a page or an asset. The
        // kit reads the route table's per-route `render` mode, and everything else falls
        // through to the built client's assets. Mounted LAST so nothing shadows the API.
        mountPages(app, options.pages);
    }

    return app;
}
