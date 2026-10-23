// Bootstrap: config, logging, the database, the outside world, serve, graceful shutdown.
// No build step - Node >= 24 runs this file directly.
//
// This is the ONLY file that reads the environment or constructs a real gateway, SMS sender
// or database. `buildApp` takes them as arguments, which is what lets the tests drive the
// entire payment flow without a network or a merchant account, on a database of their own.
//
// The environment is the SEED. Once the console has written a value it wins, so most of what
// happens here is deciding what a FIRST boot starts from.
//
// WHAT THIS PROCESS NO LONGER DOES: serve pages. nginx serves the built client and terminates
// TLS, so the HSTS header and the page-branding wrapper that used to live here are gone -
// both were about HTML this process does not emit any more. What stayed is everything that
// decides whether money moved.
import { shopName } from './domain/langs.ts';

import { pino } from 'pino';

import { createAdmin } from './features/console/session.ts';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { createGatewaySwitch, NOWPAYMENTS_PREFIX } from './features/checkout/gateway.ts';
import { createPayment } from './features/checkout/zarinpal.ts';
import { createZibal } from './features/checkout/zibal.ts';
import { createNowPayments } from './features/checkout/nowpayments.ts';
import { createMailer } from './features/checkout/mailer.ts';
import { createTetherRate } from './features/rate/rate.ts';
import { createTelegram } from './features/telegram/telegram.ts';
import {
    createBackupJob,
    createPayoutNotifier,
    createSaleNotifier
} from './features/telegram/notify.ts';
import { createCommandBot } from './features/telegram/commands.ts';
import { rateLimit } from './platform/throttle.ts';
import { seedTiers } from './domain/seed.ts';
import { createSettings, DEFAULT_ADMIN_KEY } from './features/settings/settings.ts';
import { createSms } from './features/checkout/panelsms.ts';
import {
    anyPayoutNotifier,
    createSmsPayoutNotifier,
    createSmsSaleNotifier,
    everySaleNotifier
} from './features/redeem/notify.ts';
import { createStore } from './db/index.ts';

// Redaction happens in the logger rather than at each call site, so no formatter and no
// future log line can leak a credential. `code` is here too: a gift code is bearer value,
// and a log file is not where it should be readable.
const log = pino({
    base: { service: 'ashbringer-server' },
    redact: {
        paths: [
            'merchantId',
            'merchant',
            'zibalMerchant',
            'apiKey',
            'password',
            'adminKey',
            'key',
            'currentKey',
            'newKey',
            'authority',
            'trackId',
            'code',
            'phone',
            'botToken',
            'telegramBotToken',
            'nowPaymentsApiKey',
            'resendApiKey',
            'api_key',
            'email',
            '*.merchantId',
            '*.merchant',
            '*.zibalMerchant',
            '*.apiKey',
            '*.password',
            '*.adminKey',
            '*.key',
            '*.currentKey',
            '*.newKey',
            '*.authority',
            '*.trackId',
            '*.code',
            '*.phone',
            '*.nowPaymentsApiKey',
            '*.resendApiKey',
            '*.api_key',
            '*.email',
            '*.botToken',
            '*.telegramBotToken'
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

const store = await createStore(
    { url: config.databaseUrl, poolSize: config.databasePoolSize },
    (names) => log.warn({ migrations: names }, 'database schema migrated')
);

// A catalogue is seeded exactly once. After this the console owns it, so a later change to
// seed.ts has no effect on a shop that is already trading - which is the point of moving the
// catalogue into the database.
if (await store.isCatalogueEmpty()) {
    for (const tier of seedTiers()) {
        await store.saveTier(tier);
    }
    log.info({ tiers: 3 }, 'catalogue seeded');
}

const settings = await createSettings({ store });

// THE SHIPPED DEFAULT IS A PUBLISHED CREDENTIAL. It is written down in this repository, so a
// shop reachable from the internet that still answers to it is open to anybody who has read
// that file. This is the loudest this process can be about it; the console says the same thing
// on screen, and the warning stops the moment a real key is set.
if (!settings.adminKeyRotated()) {
    process.stdout.write(
        `\n  This installation still uses the DEFAULT console key:\n\n      ${DEFAULT_ADMIN_KEY}\n\n` +
            '  Sign in at /admin and change it from the settings tab before going live.\n' +
            '  Until then, anyone who can reach this site can open the console.\n\n'
    );
    log.warn('console is using the default admin key - change it from the settings tab');
}

const live = settings.current();
if (!settings.view('').smsReady) {
    // A shop can trade without SMS: the code is on screen and valid either way. It is a
    // notice rather than a refusal because the operator can now fix it from the console
    // without a deploy.
    log.warn('SMS delivery is OFF - configure PanelSMS in the console');
}
// Only the ACTIVE gateway's credential matters here: the other one being unset is the normal
// state of a shop that uses one gateway, not something to wake anybody up about.
const merchantSet =
    live.paymentGateway === 'zibal' ? live.zibalMerchant !== '' : live.merchantId !== '';
if (!merchantSet) {
    log.warn(
        { gateway: live.paymentGateway },
        'no merchant id for the active gateway - checkout will refuse to start until one is set in the console'
    );
}

// The tether rate: one number from the console, read PER CALL so a rate saved in the panel
// prices the very next request. There is nothing to refresh and no timer to stop - which is
// the whole point of moving it out of the exchanges and into settings.
const rate = createTetherRate({
    settings: () => {
        const now = settings.current();
        return { tetherToman: now.tetherToman, tetherSetAt: now.tetherSetAt };
    }
});

if (!rate.status().selling) {
    // A fresh install boots here: nothing is sellable until somebody sets a rate, which is
    // the correct state rather than an error - it just has to be findable in the log.
    log.warn(
        { reason: rate.status().reason },
        'no tether rate - the shop will not sell until one is set in the console'
    );
}

// The operations bot. Hosts and credentials are read PER CALL, so pasting a token into the
// console turns notifications and backups on without a restart.
const telegram = createTelegram({
    settings: () => {
        const now = settings.current();
        return {
            botToken: now.telegramBotToken,
            chatId: now.telegramChatId,
            baseUrl: now.telegramBase,
            proxies: now.telegramProxies
        };
    }
});
// The SMS panel: the buyer's code, and the operator's payout ask below.
const sms = createSms({
    settings: () => {
        const now = settings.current();
        return {
            apiUrl: now.smsApiUrl,
            username: now.smsUsername,
            password: now.smsApiKey,
            domain: now.smsDomain,
            sender: now.smsSender,
            appName: now.appName
        };
    }
});
// The sale ping, to the chat and by SMS to the operator's phone - see features/redeem/notify.ts.
const notifier = everySaleNotifier(
    createSaleNotifier({
        telegram,
        appName: () => settings.current().appName,
        log
    }),
    createSmsSaleNotifier({
        sms,
        operatorPhone: () => settings.current().operatorPhone,
        appName: () => settings.current().appName,
        log
    })
);
// The payout ask. Same chat as the sale pings, but its result is WAITED FOR: /api/redeem
// records whether this got through, because a redemption nobody was told about is a person
// waiting on money that is not coming.
//
// It goes by SMS to the operator's phone as well, and counts as told when either arrived - see
// features/redeem/notify.ts.
const payouts = anyPayoutNotifier(
    createPayoutNotifier({
        telegram,
        appName: () => settings.current().appName
    }),
    createSmsPayoutNotifier({
        sms,
        operatorPhone: () => settings.current().operatorPhone,
        appName: () => settings.current().appName
    })
);
const backup = createBackupJob({
    store,
    telegram,
    appName: () => settings.current().appName,
    // Read per tick, like the credentials above: an interval changed in the console takes
    // effect on the next tick rather than on the next deploy.
    everyMinutes: () => settings.current().backupEveryMinutes,
    log
});

// The schedule starts whether or not a token is set: a bot configured at noon should start
// backing up an interval later, not at the next restart. An unconfigured run is a cheap no-op.
const stopBackups = backup.start();

// The command side: /setprice and friends, so the shop can be repriced from a phone. It polls
// rather than taking a webhook, which means no public URL to register and nothing to undo if
// the token changes - but it also means ONE of these per bot. See features/telegram/commands.ts.
const stopCommands = createCommandBot({ telegram, settings, rate, store, backup, log }).start();

if (!telegram.configured()) {
    log.warn(
        'telegram is OFF - no sale notifications, no off-machine backups, and no bot commands'
    );
}

// The English shop's gateway. Built once and handed to the app twice: it opens invoices
// directly, and verifies them through the switch below, which knows a `nowpayments:` handle.
const nowpayments = createNowPayments({
    settings: () => {
        const now = settings.current();
        return { apiKey: now.nowPaymentsApiKey, baseUrl: now.nowPaymentsBase };
    },
    paymentsFor: (invoiceId) => store.paymentsFor(`${NOWPAYMENTS_PREFIX}${invoiceId}`)
});

const app = buildApp({
    store,
    settings,
    rate,
    telegram,
    notifier,
    backup,
    payouts,
    // Both gateways are built, always. Which one OPENS a payment is asked per payment, and
    // which one VERIFIES it is read off the order - so switching in the console needs no
    // restart and strands nobody who is already on the other gateway's page.
    payment: createGatewaySwitch({
        active: () => settings.current().paymentGateway,
        zarinpal: createPayment({
            settings: () => {
                const now = settings.current();
                return { merchantId: now.merchantId, baseUrl: now.zarinpalBase };
            }
        }),
        zibal: createZibal({
            settings: () => {
                const now = settings.current();
                return { merchant: now.zibalMerchant, baseUrl: now.zibalBase };
            }
        }),
        nowpayments
    }),
    nowpayments,
    // The English shop's delivery - see features/checkout/mailer.ts.
    mail: createMailer({
        settings: () => {
            const now = settings.current();
            return {
                apiKey: now.resendApiKey,
                from: now.mailFrom,
                baseUrl: now.resendBase,
                // The email is written in English, so it carries the English name.
                appName: shopName('en', now.appName, now.appNames)
            };
        }
    }),
    reconcileEveryMs: 2 * 60 * 1000,
    sms,
    admin: createAdmin({
        matches: (candidate) => settings.matchesAdminKey(candidate),
        secureCookie: config.cookieSecure
    }),
    trustProxyHops: config.trustProxyHops,
    clientDir: config.clientDir,
    log
});

// The edge limiter is generous because most traffic is ordinary reads; the routes that cost
// money carry their own tighter ones (see app.ts).
app.addHook('onRequest', rateLimit(200, 60_000));

// The database closes AFTER in-flight requests drain: a settle mid-flight is money.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        stopBackups();
        stopCommands();
        void app.close().then(async () => {
            await store.close();
            process.exit(0);
        });
    });
}

// LOOPBACK BY DEFAULT (`HOST`). nginx runs on this machine and proxies /api through, so
// nothing else has any business reaching this port.
//
// THIS IS WHAT MAKES `TRUST_PROXY_HOPS` TRUE RATHER THAN DECORATIVE. The app trusts the last
// address in `X-Forwarded-For` because it believes nginx wrote it. Bound to every interface,
// anyone who can route to this host connects DIRECTLY and writes that header themselves - and
// every per-IP throttle, plus the console's sign-in lockout, becomes a value the attacker
// chooses. One request per forged address, forever. Binding here is the half of that setting
// that lives in the code; the other half is nginx overwriting the header (see
// platform/throttle.ts), and either alone is worthless.
//
// It also keeps the shop off the network without TLS: this process speaks plain http, and the
// only thing that makes the site https is the terminator in front of it.
//
// The Docker image sets HOST=0.0.0.0, because loopback inside a container is unreachable from
// outside it. The paragraph above then applies to the PUBLISHED port instead: publish it on
// 127.0.0.1 only (`-p 127.0.0.1:4600:4600`) so nginx is still the only way in.
await app.listen({ port: config.port, host: config.host });
log.info({ host: config.host, port: config.port, env: config.env }, 'listening');
