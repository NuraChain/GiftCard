// The catalogue's routes and handlers. The rule that a removal may only DEACTIVATE lives one
// file over in ./queries.ts - a route must not be able to drop a row that history depends on.
import type { Verbs } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import type { Store } from '../../db/types.ts';
import { tierAmountQuery, tierList, tierRemoval, tierRow } from './schemas.ts';

export interface CatalogueOptions
{
    store: Store;
    log?: Logger;
}

/** The catalogue's half of the admin surface; app.ts lands it inside the guarded feature. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
export function catalogueRoutes(routes: Verbs<Record<never, never>, '/admin'>, options: CatalogueOptions)
{
    const { store, log } = options;

    return {
        tiers: routes.get('/tiers', { output: tierList }, () => ({ tiers: store.tiers() })),

        saveTier: routes.post('/tiers', { input: tierRow, output: tierList }, ({ input }) =>
        {
            store.saveTier(input);
            log?.info('tier saved', { amount: input.amount, toman: input.toman, active: input.active });
            return { tiers: store.tiers() };
        }),

        removeTier: routes.del('/tiers', { query: tierAmountQuery, output: tierRemoval }, ({ query }) =>
        {
            const outcome = store.removeTier(query.amount);
            log?.info('tier removed', { amount: query.amount, outcome });
            return { outcome };
        })
    };
}
