// The environment, read ONCE into a typed object - one boot error names every problem.
//
// WHAT IS AND IS NOT HERE. This file holds only what the DATABASE CANNOT hold: where the
// process listens, where its file is, where the built pages are, and how it is fronted.
// Five values.
//
// EVERYTHING ELSE MOVED TO THE CONSOLE, including the two that used to be here. The public
// origin is a field beside the merchant id now, because it is the same kind of fact and
// because an operator who has stranded their buyers at the gateway needs to fix it at that
// moment rather than on the next deploy. The console credential went too: there is a shipped
// default (features/settings/settings.ts) and the database holds whatever replaces it.
//
// Two places to set one value is a trap: the database wins, so changing the environment copy
// appears to do nothing. Nobody can run this shop without opening the console regardless -
// gift codes only enter through it - so a second way to configure any of it bought nothing.
//
// `CLIENT_DIR` IS BACK, AND `SSR_ENTRY` IS NOT. The difference matters: this process still
// renders nothing and runs no client code. It hands back the files `vite build` produced,
// which is the cheapest possible way to make one origin serve both halves - so a reverse
// proxy can forward everything to one port and be done, instead of needing a `root`, a
// `try_files` and a second location block that must agree with this app's `/api` prefix.
//
// nginx serving those files directly is still FASTER and still supported: point its `root` at
// the same directory and this route simply never gets asked. What changed is that getting the
// proxy config wrong now degrades performance instead of taking the whole site down.
//
// `TRUST_PROXY_HOPS` and `COOKIE_SECURE` are the settings a reverse proxy makes the app's
// business, and both are explained where they are declared.
import { bool, loadConfig, num, oneOf, str } from './platform/env.ts';

try {
    process.loadEnvFile();
} catch {
    // No .env file - the ambient environment is the configuration.
}

export const config = loadConfig({
    port: num('PORT', { default: 4201 }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),

    // --- Being behind a proxy ---

    /**
     * How many proxies sit in front. The per-IP throttles and the sign-in lockout are only
     * as good as this number: at 0 every buyer shares nginx's address and one attacker locks
     * out the shop, and trusting the whole chain would let a client forge its own address by
     * writing an `X-Forwarded-For` of its own. One nginx in front means 1.
     */
    trustProxyHops: num('TRUST_PROXY_HOPS', { default: 1 }),

    /**
     * Adds `Secure` to the session cookie. It cannot be inferred from the request any more:
     * nginx terminates TLS, so this process always sees plain http even when the browser is
     * on https. Leave it on wherever nginx serves https - which is everywhere but a local
     * dev machine.
     */
    cookieSecure: bool('COOKIE_SECURE', { default: process.env.NODE_ENV === 'production' }),

    // --- Storage ---

    /**
     * The gift codes, the order ledger, the catalogue and the settings. One SQLite file;
     * back it up like money, because unsold codes in it ARE money.
     */
    databaseFile: str('DATABASE_FILE', { default: 'data/guardian-service.db' }),

    // --- The built client ---

    /**
     * The directory `npm run build` writes, served at `/`.
     *
     * The default is relative to the SERVER directory because that is the working directory
     * the systemd unit sets (scripts/service-install.sh), and it points at the sibling
     * workspace - so a checkout that has been built needs no configuration at all.
     *
     * Set it to an empty string to serve nothing and answer JSON on every path, which is
     * what a deployment with nginx holding the files wants.
     */
    clientDir: str('CLIENT_DIR', { default: '../application/dist' })
});

export const isProduction = config.env === 'production';
