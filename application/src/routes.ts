// The one route table.
//
// The router mounts it and nothing else declares a route, so this file is the manifest of
// what the application is. Routes are data in AzerothJS too, which keeps it the shape it has
// always had: a table is greppable and orderable in a way a tree of nested elements is not.
//
// Every page is rendered in the browser - nginx serves one built shell for every path (the
// proxy answers every path with index.html) and the router decides what goes in it.
import type { Route } from 'azerothjs';

import { homeOf, LANGS } from './lib/lang.ts';

import Landing from './pages/landing.azeroth';
import AdminOverview from './pages/admin/overview.azeroth';
import AdminCodes from './pages/admin/codes/index.azeroth';
import AdminOrders from './pages/admin/orders.azeroth';
import AdminRedemptions from './pages/admin/redemptions.azeroth';
import AdminSettings from './pages/admin/settings/index.azeroth';

export const routes: Route[] = [
    // Every language's landing page: `/` for Persian, `/en`, `/ar`... for the rest. The same
    // page in each; Persian is paid in Toman, the others in dollars through NOWPayments and
    // delivered by email. See lib/lang.ts - the address is what says which shop this is.
    ...LANGS.map((lang) => ({ path: homeOf(lang), component: Landing })),

    // The console is four ROUTES rather than four in-page tabs: a refresh keeps the operator
    // where they were, a colleague can be sent straight to the ledger, and browser back
    // works. Everything on it is a live count or somebody's phone number, so there is
    // nothing here a crawler or a CDN should ever hold.
    { path: '/admin', component: AdminOverview },
    { path: '/admin/codes', component: AdminCodes },
    { path: '/admin/orders', component: AdminOrders },
    { path: '/admin/redemptions', component: AdminRedemptions },
    { path: '/admin/settings', component: AdminSettings }
];
