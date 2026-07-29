// The environment, read ONCE into a typed object - one boot error names every problem.
//
// WHAT IS AND IS NOT HERE. This file holds only what the DATABASE CANNOT hold: where the
// process listens, where its files are, and the two keys that unlock everything else.
//
// The gateway and SMS credentials used to be here as a "seed" and are not any more. They
// live in the console, in one place. Two places to set one value is a trap: the database
// wins, so changing the environment copy appears to do nothing. And nobody can run this shop
// without opening the console regardless - gift codes only enter through it - so a second
// way to configure the gateway bought nothing.
import { loadConfig, num, oneOf, str } from '@azerothjs/http';

try
{
    process.loadEnvFile();
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

export const config = loadConfig({
    port: num('PORT', { default: 3000 }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    // Where the built client lives in production (the server serves it - one origin).
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    // The SSR bundle from `vite build --ssr` - renders `render: 'server'` pages per request.
    ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),

    // Where this server is reachable from the internet. Zarinpal sends the buyer back here,
    // so a wrong value silently strands every payment at the gateway.
    publicBaseUrl: str('PUBLIC_BASE_URL', { default: 'http://localhost:3000' }),

    // --- Storage and the console ---
    // The gift codes and the order ledger. One SQLite file; back it up like money, because
    // unsold codes in it ARE money.
    databaseFile: str('DATABASE_FILE', { default: 'data/nura.db' }),
    // OPTIONAL override for the console credential. Leave it unset and the first boot mints
    // one and prints it - no default is shipped, because a default in a public repository is
    // a published credential. Set it when a deployment pipeline needs to fix the key itself.
    adminKey: str('ADMIN_KEY', { default: '', secret: true })
});

export const isProduction = config.env === 'production';
