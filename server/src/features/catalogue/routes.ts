// The catalogue's handlers. Every route declared in ./contract.ts is implemented here, and
// the rule that a removal may only DEACTIVATE lives one file over in ./queries.ts - a route
// must not be able to drop a row that history depends on.
import type { HandlersWithGuards } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import type { contract } from '../../contract/index.ts';
import type { Store } from '../../db/types.ts';

export interface CatalogueOptions
{
    store: Store;
    log?: Logger;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type CatalogueHandlers = Pick<
    HandlersWithGuards<typeof contract, Record<never, never>>['admin'],
    'tiers' | 'saveTier' | 'removeTier'
>;

export function catalogueHandlers(options: CatalogueOptions): CatalogueHandlers
{
    const { store, log } = options;

    return {
        // GET /api/admin/tiers
        tiers: () => ({ tiers: store.tiers() }),

        // POST /api/admin/tiers
        saveTier: ({ input }: { input: Parameters<Store['saveTier']>[0] }) =>
        {
            store.saveTier(input);
            log?.info('tier saved', { amount: input.amount, toman: input.toman, active: input.active });
            return { tiers: store.tiers() };
        },

        // DELETE /api/admin/tiers
        removeTier: ({ query }: { query: { amount: number } }) =>
        {
            const outcome = store.removeTier(query.amount);
            log?.info('tier removed', { amount: query.amount, outcome });
            return { outcome };
        }
    };
}
