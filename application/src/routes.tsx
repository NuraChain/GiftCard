// The one route table.
//
// The router mounts it and nothing else declares a route, so this file is the manifest of
// what the application is. It kept that shape through the move to React: a table is greppable
// and orderable in a way a tree of nested <Route> elements is not.
//
// The per-route `render` mode that used to sit here is gone with the server that read it.
// Every page is rendered in the browser now - nginx serves one built shell for every path
// (the proxy answers every path with index.html) and the router decides what goes in it.
import type { ComponentType } from 'react';

import Landing from './pages/landing.tsx';
import AdminOverview from './pages/admin/overview.tsx';
import AdminCodes from './pages/admin/codes/index.tsx';
import AdminOrders from './pages/admin/orders.tsx';
import AdminSettings from './pages/admin/settings/index.tsx';

export interface PageRoute {
    path: string;
    Component: ComponentType;
}

export const routes: PageRoute[] = [
    { path: '/', Component: Landing },

    // The console is four ROUTES rather than four in-page tabs: a refresh keeps the operator
    // where they were, a colleague can be sent straight to the ledger, and browser back
    // works. Everything on it is a live count or somebody's phone number, so there is
    // nothing here a crawler or a CDN should ever hold.
    { path: '/admin', Component: AdminOverview },
    { path: '/admin/codes', Component: AdminCodes },
    { path: '/admin/orders', Component: AdminOrders },
    { path: '/admin/settings', Component: AdminSettings }
];
