// Bootstrap: config, logging, the database, the outside world, the edge pipeline, serve,
// graceful shutdown. No build step - Node >= 24 runs this file directly; `azeroth dev`
// (from the project root) watches it alongside the vite app.
//
// This is the ONLY file that reads the environment or constructs a real gateway, SMS client
// or database. `buildApp` takes them as arguments, which is what lets the tests drive the
// entire payment flow without a network, a merchant account, or a file on disk.
//
// The environment is the SEED. Once the console has written a value it wins, so most of what
// happens here is deciding what a FIRST boot starts from.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import
{
    pipeline, requestId, securityHeaders, rateLimit, logRequests
} from '@azerothjs/http';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';
import { createLogger } from '@azerothjs/logger';
import { fileStream } from '@azerothjs/logger/node';

import { createAdmin } from './services/admin.ts';
import { buildApp } from './app.ts';
import { brandPages } from './routes/branding.ts';
import { config, isProduction } from './config.ts';
import { createPayment } from './gateways/zarinpal.ts';
import { seedTiers } from './domain/seed.ts';
import { createSettings } from './services/settings.ts';
import { createSms } from './gateways/kavenegar.ts';
import { createStore } from './db/index.ts';

// Redaction happens in the logger rather than at each call site, so no formatter and no
// future log line can leak a credential. `code` is here too: a gift code is bearer value,
// and a log file is not where it should be readable.
const log = createLogger({
    stream: fileStream('logs/'),
    fields: { service: 'nura-chain-server' },
    redact: ['merchantId', 'apiKey', 'adminKey', 'key', 'currentKey', 'newKey', 'authority', 'code', 'phone']
});

mkdirSync(dirname(config.databaseFile), { recursive: true });
const store = createStore(config.databaseFile);

// A catalogue is seeded exactly once. After this the console owns it, so a later change to
// seed.ts has no effect on a shop that is already trading - which is the point of moving the
// catalogue into the database.
if (store.isCatalogueEmpty())
{
    for (const tier of seedTiers())
    {
        store.saveTier(tier);
    }
    log.info('catalogue seeded', { tiers: 3 });
}

const settings = createSettings({ store, adminKey: config.adminKey });

// A fresh install has no way in until a credential exists. Rather than ship a default - which
// in a public repository is a published credential - one is MINTED here and printed once.
// Only its hash is stored, so this is the only moment it can be read.
const mintedKey = settings.ensureAdminKey();
if (mintedKey !== null)
{
    process.stdout.write(
        `\n  Console credential for this installation (shown once):\n\n      ${ mintedKey }\n\n`
        + '  Sign in at /admin, then rotate it from the settings tab.\n'
        + '  It is stored as a hash - nobody, including this server, can print it again.\n\n'
    );
}

const live = settings.current();
if (!settings.view('').smsReady)
{
    // A shop can trade without SMS: the code is on screen and valid either way. It is a
    // notice rather than a refusal because the operator can now fix it from the console
    // without a deploy.
    log.warn('SMS delivery is OFF - codes appear on screen only');
}
if (live.merchantId === '')
{
    log.warn('no Zarinpal merchant id - checkout will refuse to start until one is set in the console');
}

// In dev, vite serves the client and proxies /api here. In production this server
// serves the whole app itself - one origin, no CORS between halves: the SSR bundle
// (ONE self-contained file from `vite build --ssr`) provides the route table and
// the page renderer the kit mounts.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const app = buildApp({
    dev: !isProduction,
    observe: logRequests(log),
    store,
    settings,
    payment: createPayment({
        settings: () =>
        {
            const now = settings.current();
            return { merchantId: now.merchantId, baseUrl: now.zarinpalBase };
        }
    }),
    sms: createSms({
        settings: () =>
        {
            const now = settings.current();
            return { apiKey: now.kavenegarKey, template: now.kavenegarTemplate, baseUrl: now.kavenegarBase };
        }
    }),
    admin: createAdmin({ matches: (candidate) => settings.matchesAdminKey(candidate), secureCookie: isProduction }),
    callbackUrl: `${ config.publicBaseUrl }/api/pay/callback`,
    log,
    pages: ssr === undefined
        ? undefined
        : { routes: ssr.routes, clientDir: config.clientDir, renderer: ssr.renderPage }
});

const handler = pipeline(
    app,
    brandPages(settings),
    requestId(),
    // HSTS is on in production only: sending it from a local http origin would pin a browser
    // to https for a host that does not serve it, and that is a self-inflicted outage.
    securityHeaders({ hsts: isProduction ? { maxAgeSeconds: 31_536_000, includeSubDomains: true } : false }),
    rateLimit({ limit: 200, windowMs: 60_000 })
);

const served = await serve(handler, { port: config.port });
// The database closes AFTER in-flight requests drain: a settle mid-flight is money.
handleShutdownSignals(served, { beforeExit: () => store.close() });
log.info('listening', { port: served.port, env: config.env });
