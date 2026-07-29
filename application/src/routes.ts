// The one route table. The client router mounts it, the SSR entry renders through it,
// and the kit's server half reads the per-route `render` mode from it - there is no
// second manifest.
import type { PageRoute } from '@azerothjs/kit';

import Landing from './pages/landing.azeroth';
import AdminOverview from './pages/admin/overview.azeroth';
import AdminCodes from './pages/admin/codes.azeroth';
import AdminOrders from './pages/admin/orders.azeroth';
import AdminSettings from './pages/admin/settings.azeroth';

export const routes: PageRoute[] = [
    // Rendered PER REQUEST so the server can stamp the shop's configured name into the
    // `<title>` and the first paint (see server/src/routes/branding.ts) - a build-time file
    // would carry whatever name the shop had on the day it was built.
    //
    // KNOWN LIMIT, so nobody reads more into this than it does: the CARDS are not in the
    // server HTML. They are fetched by the browser, so their titles and prices are not in
    // the document a crawler reads. The hero, the steps and the FAQ are. Closing that gap
    // means giving this route a loader that reads the catalogue during the render.
    { path: '/', component: Landing, render: 'server' },

    // The console renders in the browser only. Everything on it is a live count or somebody's
    // phone number, so there is nothing to prerender and nothing that should ever end up in a
    // crawler's index or a CDN cache.
    //
    // These are four ROUTES rather than four in-page tabs: a refresh keeps the operator where
    // they were, a colleague can be sent straight to the ledger, and browser back works.
    { path: '/admin', component: AdminOverview, render: 'client' },
    { path: '/admin/codes', component: AdminCodes, render: 'client' },
    { path: '/admin/orders', component: AdminOrders, render: 'client' },
    { path: '/admin/settings', component: AdminSettings, render: 'client' }
];
