// The catalogue's wire shapes and routes: what the shop sells, as the console edits it.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/` - anything else would drag the server into the
// browser bundle.
import { z } from 'zod';

import { del, get, post } from '../../platform/contract.ts';
import { amountField, amountQueryField } from '../../contract/shared.ts';

/**
 * A card as the console EDITS it. The copy lives here rather than in the page because the
 * catalogue is editable: a denomination added this afternoon needs its own words.
 *
 * THERE IS NO PRICE FIELD, and its absence is the feature. A card's price is its dollar
 * figure times the live tether rate times one shop-wide margin (domain/pricing.ts), so a
 * per-card Toman figure would be a second answer to a question that already has one - and
 * the two would disagree the moment the rate moved. The margin is in the settings tab; the
 * dollar figure is right here; nothing else is a price.
 */
export const tierInput = z.object({
    amount: amountField,
    title: z.string().trim().max(80),
    blurb: z.string().trim().max(400),
    recommended: z.boolean(),
    active: z.boolean(),
    sort: z.number().int().min(0).max(999)
});

/**
 * A card as the console READS it: everything above, plus what it currently sells for.
 *
 * `toman` is computed on the way out and ignored on the way in - it is a preview of the same
 * arithmetic the shop does, so the operator can see the effect of a margin change without
 * opening the storefront. Null when no rate is available, exactly as on the shop.
 */
export const tierRow = tierInput.extend({
    toman: z.number().int().nullable()
});

export const tierList = z.object({ tiers: z.array(tierRow) });

/**
 * Which tier to remove, in the QUERY STRING rather than a DELETE body.
 *
 * A DELETE body has no defined semantics in RFC 9110 and intermediaries are free to drop
 * it. The other portable shape, `DELETE /admin/tiers/:amount`, would put the amount in a
 * path param - and path params are raw strings with no schema behind them, so the "is this
 * a positive integer" check would move out of the contract and into the handler. As a query
 * param it stays validated at the boundary, which is the point of having a contract.
 */
export const tierAmountQuery = z.object({ amount: amountQueryField });

/**
 * What happened to a removal request. `deactivated` is not a failure: a tier with codes or
 * orders behind it keeps its row so that history still explains what someone paid.
 */
export const tierRemoval = z.object({
    outcome: z.enum(['deleted', 'deactivated', 'missing'])
});

export type TierInput = z.infer<typeof tierInput>;
export type TierRow = z.infer<typeof tierRow>;

/**
 * The catalogue's routes. They join the `admin` group in ../../contract/index.ts - the group
 * is the client's call path (`client.admin.tiers()`) and stays stable while the declarations
 * live with the feature that owns them.
 */
export const catalogueRoutes = {
    tiers: get('/admin/tiers', { output: tierList }),
    saveTier: post('/admin/tiers', { input: tierInput, output: tierList }),
    removeTier: del('/admin/tiers', { query: tierAmountQuery, output: tierRemoval })
};
