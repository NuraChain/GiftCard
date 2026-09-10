import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        proxy: {
            // The server half of this app, in DEV only. `npm run dev:api` and
            // `npm run dev:web` from the repo root run the two halves in separate
            // terminals; this line is the whole dev wiring between them.
            //
            // In production nothing here applies: nginx serves the files this build
            // produces and proxies /api to the server itself. The two are the same
            // arrangement, and keeping the prefix identical is what lets `lib/api.ts`
            // name one base URL for both.
            '/api': 'http://localhost:3000'
        }
    },
    test: {
        environment: 'happy-dom'
    }
});
