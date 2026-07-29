// THE shared API contract - one declaration, both sides of the wire.
//
// The server mounts it (app.ts: mountApi) and the application imports it for the fully
// inferred client (application/src/api.ts). Read THIS file to see the whole API surface;
// read pay.ts or admin.ts for one feature's shapes, beside the routes/ file of the same
// name that implements them.
//
// CLIENT-SAFE BY CONSTRUCTION, and that is a property of EVERY file in this folder, not
// just this one. A module here may import `@azerothjs/http/api/client`, `@azerothjs/schema`
// and `domain/phone.ts` - nothing else. Reaching for the store, a service or a gateway from
// here would drag the whole server into the browser bundle.
import { defineContract } from '@azerothjs/http/api/client';

import { catalogueRoutes } from '../features/catalogue/contract.ts';
import { inventoryRoutes } from '../features/inventory/contract.ts';
import { settingsRoutes } from '../features/settings/contract.ts';
import { consoleRoutes } from '../features/console/contract.ts';
import { checkoutRoutes } from '../features/checkout/contract.ts';

// Both halves' schemas and their inferred types, re-exported so an importer needs one path.
export * from './shared.ts';
export * from '../features/checkout/contract.ts';
export * from '../features/console/contract.ts';
export * from '../features/catalogue/contract.ts';
export * from '../features/inventory/contract.ts';
export * from '../features/settings/contract.ts';

/** The whole API, in one screen. Each group's routes live in the file of that name. */
export const contract = defineContract({
    pay: checkoutRoutes,
    admin: { ...consoleRoutes, ...catalogueRoutes, ...inventoryRoutes, ...settingsRoutes }
});
