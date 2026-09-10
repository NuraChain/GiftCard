// The environment, read ONCE into a typed object - one boot error names every problem.
//
// WHAT IS AND IS NOT HERE. This file holds only what the DATABASE CANNOT hold: where the
// process listens, where its files are, how it is fronted, and the one key that unlocks
// everything else.
//
// The gateway and mail credentials are NOT here. They live in the console, in one place. Two
// places to set one value is a trap: the database wins, so changing the environment copy
// appears to do nothing. And nobody can run this shop without opening the console regardless
// - gift codes only enter through it - so a second way to configure the gateway bought
// nothing.
//
// WHAT LEFT WHEN NGINX ARRIVED. `CLIENT_DIR` and `SSR_ENTRY` are gone: this process serves
// JSON and nothing else. nginx serves the built client and terminates TLS. What arrived in
// their place is the two settings that a reverse proxy makes the app's business -
// `TRUST_PROXY_HOPS` and `COOKIE_SECURE` - and both are explained where they are declared.
import { bool, loadConfig, num, oneOf, str } from './platform/env.ts';

try {
    process.loadEnvFile();
} catch {
    // No .env file - the ambient environment is the configuration.
}

export const config = loadConfig({
    port: num('PORT', { default: 4201 }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),

    /**
     * Where the BUYER'S BROWSER reaches this site - the public origin nginx answers on, not
     * this process's own address. Zarinpal sends the buyer back here, so a wrong value
     * silently strands every payment at the gateway.
     */
    publicBaseUrl: str('PUBLIC_BASE_URL', { default: 'http://localhost:4200' }),

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

    // --- Storage and the console ---

    /**
     * The gift codes, the order ledger, the catalogue and the settings. One SQLite file;
     * back it up like money, because unsold codes in it ARE money.
     */
    databaseFile: str('DATABASE_FILE', { default: 'data/guardian-service.db' }),

    /**
     * OPTIONAL override for the console credential. Leave it unset and the first boot mints
     * one and prints it - no default is shipped, because a default in a public repository is
     * a published credential. Set it when a deployment pipeline needs to fix the key itself.
     */
    adminKey: str('ADMIN_KEY', { default: '', secret: true })
});

export const isProduction = config.env === 'production';
