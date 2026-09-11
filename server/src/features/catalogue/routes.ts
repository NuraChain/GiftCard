// The catalogue's handlers. Every route declared in ./contract.ts is implemented here, and
// the rule that a removal may only DEACTIVATE lives one file over in ./queries.ts - a route
// must not be able to drop a row that history depends on.
//
// The price on the way out is COMPUTED, never stored: same rate, same margin, same function
// as the shop uses (domain/pricing.ts), so what the console previews is what a buyer is
// charged. A null price here means the same thing it means on the storefront - no tether rate
// has been set, so nothing can be priced.
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import type { contract } from '../../contract/index.ts';
import type { Store, Tier } from '../../db/types.ts';
import { tomanPrice } from '../../domain/pricing.ts';
import type { TetherRate } from '../rate/rate.ts';
import type { Settings } from '../settings/settings.ts';

export interface CatalogueOptions {
    store: Store;
    rate: TetherRate;
    settings: Settings;
    log?: Logger;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type CatalogueHandlers = Pick<
    Handlers<typeof contract>['admin'],
    'tiers' | 'saveTier' | 'removeTier'
>;

export function catalogueHandlers(options: CatalogueOptions): CatalogueHandlers {
    const { store, rate, settings, log } = options;

    /**
     * Every tier with today's price against it. Read fresh per call - the console can
     * change the rate or the margin between two of them.
     *
     * The row is written out field by field rather than spread: this is a WIRE shape, and a
     * spread would silently publish whatever column the tier table grows next.
     */
    function priced(): Array<Tier & { toman: number | null }> {
        const live = rate.current();
        const margin = settings.current().marginPercent;
        return store.tiers().map((tier) => ({
            amount: tier.amount,
            toman: live === null ? null : tomanPrice(tier.amount, live.toman, margin),
            title: tier.title,
            blurb: tier.blurb,
            recommended: tier.recommended,
            active: tier.active,
            sort: tier.sort
        }));
    }

    return {
        // GET /api/admin/tiers
        tiers: () => ({ tiers: priced() }),

        // POST /api/admin/tiers
        saveTier: ({ input }) => {
            store.saveTier(input);
            log?.info({ amount: input.amount, active: input.active }, 'tier saved');
            return { tiers: priced() };
        },

        // DELETE /api/admin/tiers
        removeTier: ({ query }) => {
            const outcome = store.removeTier(query.amount);
            log?.info({ amount: query.amount, outcome }, 'tier removed');
            return { outcome };
        }
    };
}
