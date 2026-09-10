// Bootstrap: config, logging, the database, the outside world, serve, graceful shutdown.
// No build step - Node >= 24 runs this file directly.
//
// This is the ONLY file that reads the environment or constructs a real gateway, mailer
// or database. `buildApp` takes them as arguments, which is what lets the tests drive the
// entire payment flow without a network, a merchant account, or a file on disk.
//
// The environment is the SEED. Once the console has written a value it wins, so most of what
// happens here is deciding what a FIRST boot starts from.
//
// WHAT THIS PROCESS NO LONGER DOES: serve pages. nginx serves the built client and terminates
// TLS, so the HSTS header and the page-branding wrapper that used to live here are gone -
// both were about HTML this process does not emit any more. What stayed is everything that
// decides whether money moved.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { pino } from 'pino';

import { createAdmin } from './features/console/session.ts';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { createPayment } from './features/checkout/zarinpal.ts';
import { createTetherRate } from './features/rate/rate.ts';
import { nobitexSource, wallexSource } from './features/rate/sources.ts';
import { rateLimit } from './platform/throttle.ts';
import { seedTiers } from './domain/seed.ts';
import { createSettings } from './features/settings/settings.ts';
import { createMailer } from './features/checkout/mailer.ts';
import { createStore } from './db/index.ts';

// Redaction happens in the logger rather than at each call site, so no formatter and no
// future log line can leak a credential. `code` is here too: a gift code is bearer value,
// and a log file is not where it should be readable.
const log = pino({
    base: { service: 'guardian-service-server' },
    redact: {
        paths: [
            'merchantId',
            'apiKey',
            'adminKey',
            'key',
            'currentKey',
            'newKey',
            'authority',
            'code',
            'email',
            '*.merchantId',
            '*.apiKey',
            '*.adminKey',
            '*.key',
            '*.currentKey',
            '*.newKey',
            '*.authority',
            '*.code',
            '*.email'
        ],
        censor: '[redacted]'
    },
    transport: {
        target: 'pino-roll',
        options: {
            file: 'logs/app.ndjson',
            frequency: 'daily',
            extension: '.ndjson',
            mkdir: true,
            dateFormat: 'yyyy-MM-dd'
        }
    }
});

mkdirSync(dirname(config.databaseFile), { recursive: true });
const store = createStore(config.databaseFile, (names) =>
    log.warn({ migrations: names }, 'database schema migrated')
);

// A catalogue is seeded exactly once. After this the console owns it, so a later change to
// seed.ts has no effect on a shop that is already trading - which is the point of moving the
// catalogue into the database.
if (store.isCatalogueEmpty()) {
    for (const tier of seedTiers()) {
        store.saveTier(tier);
    }
    log.info({ tiers: 3 }, 'catalogue seeded');
}

const settings = createSettings({ store, adminKey: config.adminKey });

// A fresh install has no way in until a credential exists. Rather than ship a default - which
// in a public repository is a published credential - one is MINTED here and printed once.
// Only its hash is stored, so this is the only moment it can be read.
const mintedKey = settings.ensureAdminKey();
if (mintedKey !== null) {
    process.stdout.write(
        `\n  Console credential for this installation (shown once):\n\n      ${mintedKey}\n\n` +
            '  Sign in at /admin, then rotate it from the settings tab.\n' +
            '  It is stored as a hash - nobody, including this server, can print it again.\n\n'
    );
}

const live = settings.current();
if (!settings.view('').mailReady) {
    // A shop can trade without email: the code is on screen and valid either way. It is a
    // notice rather than a refusal because the operator can now fix it from the console
    // without a deploy.
    log.warn('email delivery is OFF - codes appear on screen only');
}
if (live.merchantId === '') {
    log.warn(
        'no Zarinpal merchant id - checkout will refuse to start until one is set in the console'
    );
}

// The tether rate: two exchanges, cross-checked, refreshed on a timer. The hosts are read
// PER CALL from settings so repointing one in the console takes effect without a restart.
const rate = createTetherRate({
    sources: [
        nobitexSource({ baseUrl: () => settings.current().nobitexBase }),
        wallexSource({ baseUrl: () => settings.current().wallexBase })
    ],
    log
});

// One reading BEFORE the port opens. Without it the first buyers of every deploy meet a shop
// that cannot price anything for the first minute, which looks exactly like a broken site.
await rate.refresh();
const stopRate = rate.start();
if (!rate.status().selling) {
    log.error(
        { reason: rate.status().reason },
        'no agreed tether rate - the shop will not sell until two exchanges agree'
    );
}

const app = buildApp({
    store,
    settings,
    rate,
    payment: createPayment({
        settings: () => {
            const now = settings.current();
            return { merchantId: now.merchantId, baseUrl: now.zarinpalBase };
        }
    }),
    mailer: createMailer({
        settings: () => {
            const now = settings.current();
            return {
                host: now.smtpHost,
                port: now.smtpPort,
                secure: now.smtpSecure,
                user: now.smtpUser,
                password: now.smtpPassword,
                from: now.smtpFrom,
                appName: now.appName
            };
        }
    }),
    admin: createAdmin({
        matches: (candidate) => settings.matchesAdminKey(candidate),
        secureCookie: config.cookieSecure
    }),
    callbackUrl: `${config.publicBaseUrl}/api/pay/callback`,
    trustProxyHops: config.trustProxyHops,
    log
});

// The edge limiter is generous because most traffic is ordinary reads; the routes that cost
// money carry their own tighter ones (see app.ts).
app.addHook('onRequest', rateLimit(200, 60_000));

// The database closes AFTER in-flight requests drain: a settle mid-flight is money.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        stopRate();
        void app.close().then(() => {
            store.close();
            process.exit(0);
        });
    });
}

// Bound to every interface: inside a container the only way in is nginx, and binding to
// localhost there would make the service unreachable from the proxy container.
await app.listen({ port: config.port, host: '0.0.0.0' });
log.info({ port: config.port, env: config.env }, 'listening');
