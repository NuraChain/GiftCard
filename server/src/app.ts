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
// EVERY ROUTE IS UNDER /api, AND ONLY /api. That is still true of the API: there is no CORS
// layer here and no security-header layer, because it is one origin as far as the browser is
// concerned and the headers that belong to a TLS terminator belong to the terminator.
//
// WHAT SITS UNDER EVERYTHING ELSE is the built client, when there is one - see `mountClient`
// at the bottom. It is a fallback, not a feature: nginx pointed at the same directory is
// faster and is still the right answer for a busy shop. It exists because the alternative
// failure is catastrophic and silent. A proxy that forwards `/` here without a `root` and a
// `try_files` produces a site whose every page is this API's 404, which looks like the app is
// broken rather than like the proxy is misconfigured - and that is a bad trade for a saving
// nobody at this size can measure.
//
// Nothing here reads config or touches the network by itself, so the whole flow - including
// the forged-callback, replay and sold-out paths - is exercised by handing `buildApp` an
// in-memory database and two fakes.
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
    type FastifyBaseLogger,
    type FastifyError,
    type FastifyInstance,
    type FastifyReply
} from 'fastify';

import { guard, mountApi } from './platform/api.ts';
import { HttpError } from './platform/http.ts';
import { contract } from './contract/index.ts';
import type { Store } from './db/index.ts';
import { catalogueHandlers } from './features/catalogue/routes.ts';
import { createCheckout } from './features/checkout/checkout.ts';
import { mountPayCallback, payHandlers } from './features/checkout/routes.ts';
import type { MailSender } from './features/checkout/mailer.ts';
import type { PaymentGateway } from './features/checkout/zarinpal.ts';
import { consoleHandlers } from './features/console/routes.ts';
import { SESSION_COOKIE, type Admin } from './features/console/session.ts';
import { inventoryHandlers } from './features/inventory/routes.ts';
import type { TetherRate } from './features/rate/rate.ts';
import { rateHandlers } from './features/rate/routes.ts';
import type { BackupJob, PayoutNotifier, SaleNotifier } from './features/telegram/notify.ts';
import { redeemHandlers } from './features/redeem/routes.ts';
import { telegramHandlers } from './features/telegram/routes.ts';
import type { Telegram } from './features/telegram/telegram.ts';
import { settingsHandlers } from './features/settings/routes.ts';
import type { Settings } from './features/settings/settings.ts';
import { throttle } from './platform/throttle.ts';

export interface AppOptions {
    store: Store;
    payment: PaymentGateway;
    mailer: MailSender;
    admin: Admin;

    /** Runtime configuration: credentials and hosts the console can change without a deploy. */
    settings: Settings;

    /**
     * The tether rate, as the console set it. Every price the shop shows and every sum it
     * charges comes from this; when it has nothing to give, the cards go unbuyable rather
     * than falling back to a number nobody chose.
     */
    rate: TetherRate;

    /** The operations bot: a ping per sale, and the hourly database backup. */
    telegram: Telegram;
    notifier: SaleNotifier;
    backup: BackupJob;

    /**
     * The payout ask. Separate from `notifier` because it is AWAITED and its failure is
     * recorded - it is the only notice a human gets that somebody is owed a transfer.
     */
    payouts: PayoutNotifier;

    /** Where the buyer lands afterwards; the receipt token is appended. */
    resultPath?: string;

    /**
     * The directory `vite build` wrote, served at `/` with a single-page fallback.
     *
     * ABSENT OR MISSING IS A SUPPORTED STATE, not an error: the tests pass nothing, a dev run
     * is served by vite itself, and a deployment where nginx holds the files wants this off.
     * All three answer JSON on every path, exactly as this process always did.
     */
    clientDir?: string;

    /**
     * How many proxies sit in front. See config.ts - at 0 every request appears to come from
     * nginx and every per-IP limit in the app becomes one shared bucket.
     */
    trustProxyHops?: number;

    log?: FastifyBaseLogger;
}

/**
 * @internal The client's document, with the headers it must always carry.
 *
 * NO CACHING, EVER. It names the hashed bundles, so a stale copy points at files the next
 * deploy deletes - and the site breaks for exactly the people who visited most recently,
 * which is the worst possible set. The bundles it names are cached for a year instead, which
 * is safe because a change of content is a change of filename.
 *
 * `cacheControl: false` is what makes that header survive: the static plugin is registered
 * with a year of immutable caching for those bundles, and `sendFile` would otherwise stamp
 * the same thing onto this document.
 */
function sendDocument(reply: FastifyReply): FastifyReply {
    return reply
        .header('cache-control', 'no-store')
        .type('text/html; charset=utf-8')
        .sendFile('index.html', { cacheControl: false });
}

/**
 * @internal Serves the built client at `/`, or nothing at all.
 *
 * Returns the resolved directory, or null when there is nothing to serve - which is the
 * normal state in tests and in development, and a deliberate one behind an nginx that holds
 * the files itself.
 *
 * A MISSING DIRECTORY IS A WARNING, NEVER A CRASH. The API is the half that moves money; a
 * shop that has taken a payment must not fail to settle it because somebody forgot to run
 * `npm run build`. The warning is loud, and `/api` keeps working.
 */
function mountClient(
    app: FastifyInstance,
    clientDir: string | undefined,
    log?: FastifyBaseLogger
): string | null {
    if (clientDir === undefined || clientDir === '') {
        return null;
    }

    // Relative to the process's working directory, which the systemd unit sets to `server/`.
    const root = isAbsolute(clientDir) ? clientDir : resolve(process.cwd(), clientDir);
    if (!existsSync(join(root, 'index.html'))) {
        log?.warn(
            { clientDir: root },
            'no built client to serve - run npm run build, or point nginx at the files instead'
        );
        return null;
    }

    app.register(fastifyStatic, {
        root,

        // CACHING IS DECIDED PER FILE, because this directory holds two kinds of thing and
        // one rule for both is wrong either way.
        //
        // Everything under /assets carries a content hash in its NAME, so a year of immutable
        // is not just safe, it is the whole point of the hash: different content can never
        // reuse a URL. The favicons do not - `favicon-32.png` is `favicon-32.png` forever, so
        // caching one for a year means a new logo reaches nobody who has already visited
        // until 2027. They get a day, which is long enough to cost nothing and short enough
        // that a change lands.
        cacheControl: false,
        setHeaders: (reply, filePath) => {
            const served = filePath.replace(/\\/g, '/');

            // index.html is NOT this callback's business: `sendDocument` already set
            // `no-store` on it, and this runs afterwards - so without the exit below it
            // would hand a day of caching to the one file that must never have any.
            if (served.endsWith('/index.html')) {
                return;
            }
            const hashed = served.includes('/assets/');
            reply.header(
                'cache-control',
                hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'
            );
        },

        // `/` would otherwise be answered by this plugin with index.html and a year of cache
        // headers. It goes through the not-found handler instead, which is the one place the
        // single-page fallback and its caching rules are decided.
        index: false,

        // Dotfiles are configuration and secrets, never content.
        serveDotFiles: false
    });

    log?.info({ clientDir: root }, 'serving the built client');
    return root;
}

export function buildApp(options: AppOptions): FastifyInstance {
    const { store, payment, mailer, admin, settings, rate, log } = options;
    const { telegram, notifier, backup, payouts } = options;
    const resultPath = options.resultPath ?? '/';

    /**
     * Where Zarinpal returns the buyer, built from the public origin in the console.
     *
     * A FUNCTION, not a string, and read at the moment a payment starts: the origin is a
     * setting now, so an operator correcting it must not have to restart the process to
     * un-strand the next buyer. The path is the app's own business and lives here rather than
     * in settings, so there is one spelling of it and no second copy to drift.
     */
    const callbackUrl = (): string => `${settings.current().publicBaseUrl}/api/pay/callback`;

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
    app.setErrorHandler((error: FastifyError, request, reply) => {
        if (error instanceof HttpError) {
            if (error.retryAfter !== undefined) {
                reply.header('retry-after', String(error.retryAfter));
            }
            return reply.code(error.status).send({
                error: { code: error.code, message: error.message, details: error.details }
            });
        }

        // Fastify's own refusals - a malformed JSON body, an unsupported media type - already
        // carry a sensible 4xx. They are passed through rather than dressed as a crash.
        const status =
            typeof error.statusCode === 'number' &&
            error.statusCode >= 400 &&
            error.statusCode < 500
                ? error.statusCode
                : 500;
        if (status === 500) {
            log?.error({ err: error, url: request.url }, 'unhandled failure');
        }
        return reply.code(status).send({
            error: {
                code: status === 500 ? 'internal' : 'bad-request',
                message: status === 500 ? 'خطای غیرمنتظره‌ای رخ داد' : 'درخواست نامعتبر است'
            }
        });
    });

    // Mounted BEFORE the not-found handler is replaced, because that handler is what serves
    // the single-page fallback and it needs to know whether there is anything to fall back to.
    const clientRoot = mountClient(app, options.clientDir, log);

    // THE ROOT NEEDS ITS OWN ROUTE. @fastify/static is mounted with `index: false` - so that
    // the document is served from one place with one set of headers - and that makes a
    // request for `/` a request for a directory, which it answers 403 without ever reaching
    // the not-found handler below.
    if (clientRoot !== null) {
        app.get('/', (_request, reply) => sendDocument(reply));
    }

    /**
     * Nothing matched. What that MEANS depends on who asked.
     *
     * A request under /api is a call to a route that does not exist, and it gets the JSON
     * refusal every other failure here gets. Anything else is a PAGE, and the client is a
     * single-page app - `/admin/orders` is a route its router knows and not a file on disk -
     * so the document is handed back and the browser decides. That is the `try_files
     * $uri $uri/ /index.html` an nginx config would otherwise have to get right.
     */
    app.setNotFoundHandler((request, reply) => {
        const wantsPage = clientRoot !== null && !request.url.startsWith('/api');
        if (wantsPage && (request.method === 'GET' || request.method === 'HEAD')) {
            return sendDocument(reply);
        }
        return reply
            .code(404)
            .send({ error: { code: 'not-found', message: 'این آدرس وجود ندارد' } });
    });

    // The orchestrator probe: cheap, dependency-free, always 200 when the process lives. It
    // stays imperative because nothing calls it with types - see features/ for the rest.
    app.get('/api/healthz', () => ({ ok: true, at: new Date().toISOString() }));

    // The gateway's return is a browser REDIRECT, not a typed call, so checkout mounts it
    // itself rather than through the contract.
    const checkout = createCheckout({ store, payment, mailer, notifier, log });
    const pay = { store, settings, rate, payment, checkout, callbackUrl, resultPath, log };
    mountPayCallback(app, pay);

    const requireAdmin = guard(({ request }) => admin.require(request.cookies[SESSION_COOKIE]));

    mountApi(app, contract, {
        prefix: '/api',

        guards: {
            // Money or credentials: one call here costs a gateway request, an email, or a guess.
            'pay.start': [guard(throttle(8, 60_000))],

            // Tighter than checkout, for two reasons at once: every call is one guess at a
            // code, and every SUCCESS makes the shop send a chat message. A code is 122 bits
            // of random so guessing is hopeless anyway - this is about the second half.
            'redeem.submit': [guard(throttle(6, 60_000))],
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
            'admin.rate': [requireAdmin],
            'admin.telegram': [requireAdmin],

            // Both of these send something outward, and the backup sends the WHOLE DATABASE.
            // Guarded, and throttled hard enough that a stolen session cannot use them to
            // walk the business out one upload at a time.
            'admin.testTelegram': [requireAdmin, guard(throttle(5, 60_000))],
            'admin.backupNow': [requireAdmin, guard(throttle(3, 60_000))],

            // Rotation takes the CURRENT key, so it is one more place a credential can be
            // guessed against - guarded and throttled.
            'admin.rotateKey': [requireAdmin, guard(throttle(10, 60_000))],
            'admin.testEmail': [requireAdmin, guard(throttle(5, 60_000))]
        },

        // One line per feature. `mountApi` proves the union covers every route in the
        // contract, so a feature that forgets a handler fails to compile HERE.
        handlers: {
            pay: payHandlers(pay),
            redeem: redeemHandlers({ store, payouts, log }),
            admin: {
                ...consoleHandlers({ store, admin }),
                ...catalogueHandlers({ store, rate, settings, log }),
                ...inventoryHandlers({ store }),
                ...settingsHandlers({ settings, admin, mailer, callbackUrl, log }),
                ...rateHandlers({ rate, settings }),
                ...telegramHandlers({ telegram, backup, settings })
            }
        }
    });

    return app;
}
