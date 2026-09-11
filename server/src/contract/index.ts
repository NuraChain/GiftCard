// THE shared API contract - one declaration, both sides of the wire.
//
// The server mounts it (app.ts: mountApi) and the application imports it for the fully
// inferred client (application/src/lib/api.ts). Read THIS file to see the whole API surface;
// read a features/*/contract.ts for one feature's shapes, beside the routes.ts that
// implements them.
//
// CLIENT-SAFE BY CONSTRUCTION, and that is a property of EVERY file reachable from here, not
// just this one. A module in this chain may import `platform/contract.ts`, `zod` and
// `domain/` - nothing else. Reaching for the store, a service or a gateway from here would
// drag the whole server into the browser bundle.
import { defineContract } from '../platform/contract.ts';

import { catalogueRoutes } from '../features/catalogue/contract.ts';
import { inventoryRoutes } from '../features/inventory/contract.ts';
import { settingsRoutes } from '../features/settings/contract.ts';
import { consoleRoutes } from '../features/console/contract.ts';
import { checkoutRoutes } from '../features/checkout/contract.ts';
import { redeemRoutes } from '../features/redeem/contract.ts';
import { rateRoutes } from '../features/rate/contract.ts';
import { telegramRoutes } from '../features/telegram/contract.ts';

// Both halves' schemas and their inferred types, re-exported so an importer needs one path.
export * from './shared.ts';
export * from '../features/checkout/contract.ts';
export * from '../features/redeem/contract.ts';
export * from '../features/console/contract.ts';
export * from '../features/catalogue/contract.ts';
export * from '../features/inventory/contract.ts';
export * from '../features/settings/contract.ts';
export * from '../features/rate/contract.ts';
export * from '../features/telegram/contract.ts';

/** The whole API, in one screen. Each group's routes live with the feature of that name. */
export const contract = defineContract({
    pay: checkoutRoutes,

    // Its own group rather than a fourth route under `pay`: redeeming is the opposite
    // direction of travel, it is reached by a person holding a code rather than a person
    // holding a card, and it shares no session, throttle budget or failure mode with checkout.
    redeem: redeemRoutes,

    admin: {
        ...consoleRoutes,
        ...catalogueRoutes,
        ...inventoryRoutes,
        ...settingsRoutes,
        ...rateRoutes,
        ...telegramRoutes
    }
});
