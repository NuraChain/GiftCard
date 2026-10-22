import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // `.azeroth` components compile to direct DOM updates; there is no virtual DOM to ship.
    // The plugin also type-checks every component as it builds it.
    plugins: [azeroth(), tailwindcss()],
    server: {
        // Pinned, and `strictPort` so a busy 4200 is an error rather than a silent
        // move to another port: the server's PUBLIC_BASE_URL names this exact origin,
        // and the gateway sends the buyer back to it after paying.
        port: 4200,
        strictPort: true,
        proxy: {
            // The server half of this app, in DEV only. `npm run dev` from the repo
            // root starts both halves together (or `dev:api` / `dev:web` to run one
            // alone); this line is the whole dev wiring between them.
            //
            // In production nothing here applies: nginx serves the files this build
            // produces and proxies /api to the server itself. The two are the same
            // arrangement, and keeping the prefix identical is what lets `lib/api.ts`
            // name one base URL for both.
            '/api': 'http://localhost:4600'
        }
    },
    test: {
        environment: 'happy-dom',
        // @azerothjs/testing registers its own unmount-everything in `afterEach` when the
        // test globals are on, which is what keeps one test's tree out of the next one.
        globals: true
    }
});
