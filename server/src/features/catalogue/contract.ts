// The catalogue's wire shapes and routes: what the shop sells, as the console edits it.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/` - anything else would drag the server into the
// browser bundle.
import { z } from 'zod';

import { del, get, post } from '../../platform/contract.ts';
import { amountField, amountQueryField } from '../../contract/shared.ts';

/**
 * A card as the console edits it. The copy lives here rather than in the page because the
 * catalogue is editable: a denomination added this afternoon needs its own words.
 */
export const tierRow = z.object({
    amount: amountField,
    toman: z.number().int().min(1),
    title: z.string().trim().max(80),
    blurb: z.string().trim().max(400),
    recommended: z.boolean(),
    active: z.boolean(),
    sort: z.number().int().min(0).max(999)
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

export type TierRow = z.infer<typeof tierRow>;

/**
 * The catalogue's routes. They join the `admin` group in ../../contract/index.ts - the group
 * is the client's call path (`client.admin.tiers()`) and stays stable while the declarations
 * live with the feature that owns them.
 */
export const catalogueRoutes = {
    tiers: get('/admin/tiers', { output: tierList }),
    saveTier: post('/admin/tiers', { input: tierRow, output: tierList }),
    removeTier: del('/admin/tiers', { query: tierAmountQuery, output: tierRemoval })
};
