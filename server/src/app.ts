// The app, built pure: dependencies in, a Fastify instance out. WIRING ONLY.
//
// Every handler lives in `features/<name>/routes.ts`, beside the contract that declares it,
// the rules it calls, and its SQL. Nothing in this file decides anything - it says which
// feature answers which group, and which routes are guarded. If a rule appears here, it is
// in the wrong file.
//
// Reading this file should tell you three things and nothing else: the shape of the API,
// what a request has to get past before a handler sees it, and how a thrown failure becomes
// a response.
//
// EVERYTHING IS UNDER /api, AND ONLY /api. This process serves JSON. nginx serves the built
// client and proxies this prefix through - which is also why there is no CORS layer here and
// no security-header layer: one origin as far as the browser is concerned, and the headers
// that belong to a TLS terminator belong to the terminator.
//
// Nothing here reads config or touches the network by itself, so the whole flow - including
// the forged-callback, replay and sold-out paths - is exercised by handing `buildApp` an
// in-memory database and two fakes.
import cookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';

import { guard, mountApi } from './platform/api.ts';
import { HttpError } from './platform/http.ts';
import { contract } from './contract/index.ts';
import type { Store } from './db/index.ts';
import { catalogueHandlers } from './features/catalogue/routes.ts';
import { createCheckout } from './features/checkout/checkout.ts';
import { mountPayCallback, payHandlers } from './features/checkout/routes.ts';
import type { SmsSender } from './features/checkout/sms.ts';
import type { PaymentGateway } from './features/checkout/zarinpal.ts';
import { consoleHandlers } from './features/console/routes.ts';
import { SESSION_COOKIE, type Admin } from './features/console/session.ts';
import { inventoryHandlers } from './features/inventory/routes.ts';
import { settingsHandlers } from './features/settings/routes.ts';
import type { Settings } from './features/settings/settings.ts';
import { throttle } from './platform/throttle.ts';

export interface AppOptions
{
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

    /**
     * How many proxies sit in front. See config.ts - at 0 every request appears to come from
     * nginx and every per-IP limit in the app becomes one shared bucket.
     */
    trustProxyHops?: number;

    log?: FastifyBaseLogger;
}

export function buildApp(options: AppOptions): FastifyInstance
{
    const { store, payment, sms, admin, settings, callbackUrl, log } = options;
    const resultPath = options.resultPath ?? '/';

    // Fastify's published types allow a boolean, a string, a list or a function here, but
    // proxy-addr - the library actually behind it - also documents a NUMBER, meaning "trust
    // this many hops counted back from us". That is the only form that is correct behind
    // exactly one nginx: `true` would let a client forge its own address by sending an
    // `X-Forwarded-For` of its own. The cast is to the type declaration, not to reality.
    const trustProxy = (options.trustProxyHops ?? 0) as unknown as boolean;

    const app = Fastify({
        // The instance shares the caller's logger, so redaction is configured once and no
        // request line can leak what the application's own lines are careful not to. A test
        // passes none, which turns request logging off by itself - there is nothing to log to.
        loggerInstance: log,
        trustProxy
    });

    app.register(cookie);

    /**
     * Every refusal, in one envelope. A handler throws an `HttpError` and this is the only
     * place that turns one into a status - which is what keeps the shape uniform enough for
     * the client to parse it back into an `ApiError` without knowing the route.
     *
     * Anything else is a bug: it is logged in full and answered with a bare 500, because the
     * inside of a stack trace is not the buyer's business.
     */
    app.setErrorHandler((error: FastifyError, request, reply) =>
    {
        if (error instanceof HttpError)
        {
            if (error.retryAfter !== undefined)
            {
                reply.header('retry-after', String(error.retryAfter));
            }
            return reply.code(error.status).send({
                error: { code: error.code, message: error.message, details: error.details }
            });
        }

        // Fastify's own refusals - a malformed JSON body, an unsupported media type - already
        // carry a sensible 4xx. They are passed through rather than dressed as a crash.
        const status = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
            ? error.statusCode
            : 500;
        if (status === 500)
        {
            log?.error({ err: error, url: request.url }, 'unhandled failure');
        }
        return reply.code(status).send({
            error: {
                code: status === 500 ? 'internal' : 'bad-request',
                message: status === 500 ? 'خطای غیرمنتظره‌ای رخ داد' : 'درخواست نامعتبر است'
            }
        });
    });

    app.setNotFoundHandler((request, reply) =>
        reply.code(404).send({ error: { code: 'not-found', message: 'این آدرس وجود ندارد' } }));

    // The orchestrator probe: cheap, dependency-free, always 200 when the process lives. It
    // stays imperative because nothing calls it with types - see features/ for the rest.
    app.get('/api/healthz', () => ({ ok: true, at: new Date().toISOString() }));

    // The gateway's return is a browser REDIRECT, not a typed call, so checkout mounts it
    // itself rather than through the contract.
    const checkout = createCheckout({ store, payment, sms, log });
    const pay = { store, settings, payment, checkout, callbackUrl, resultPath, log };
    mountPayCallback(app, pay);

    const requireAdmin = guard(({ request }) => admin.require(request.cookies[SESSION_COOKIE]));

    mountApi(app, contract, {
        prefix: '/api',

        guards: {
            // Money or credentials: one call here costs a gateway request, an SMS, or a guess.
            'pay.start': [guard(throttle(8, 60_000))],
            'admin.signIn': [guard(throttle(10, 60_000))],

            // Everything in the console except signing in - that route IS how you get past
            // this guard.
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

        // One line per feature. `mountApi` proves the union covers every route in the
        // contract, so a feature that forgets a handler fails to compile HERE.
        handlers: {
            pay: payHandlers(pay),
            admin: {
                ...consoleHandlers({ store, admin }),
                ...catalogueHandlers({ store, log }),
                ...inventoryHandlers({ store }),
                ...settingsHandlers({ settings, admin, sms, callbackUrl, log })
            }
        }
    });

    return app;
}
