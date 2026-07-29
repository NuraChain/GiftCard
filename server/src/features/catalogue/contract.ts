// The catalogue's wire shapes and routes: what the shop sells, as the console edits it.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `@azerothjs/http/api/client`, `@azerothjs/schema` and `domain/` - anything else would
// drag the server into the browser bundle.
import { del, get, post } from '@azerothjs/http/api/client';
import { array, boolean, literal, number, object, string, union, type Infer } from '@azerothjs/schema';

import { amountField, amountQueryField } from '../../contract/shared.ts';

/**
 * A card as the console edits it. The copy lives here rather than in the page because the
 * catalogue is editable: a denomination added this afternoon needs its own words.
 */
export const tierRow = object({
    amount: amountField,
    toman: number({ int: true, min: 1 }),
    title: string({ trim: true, max: 80 }),
    blurb: string({ trim: true, max: 400 }),
    sample: string({ trim: true, max: 80 }),
    recommended: boolean(),
    active: boolean(),
    sort: number({ int: true, min: 0, max: 999 })
});

export const tierList = object({ tiers: array(tierRow) });

/**
 * Which tier to remove, in the QUERY STRING rather than a DELETE body.
 *
 * A DELETE body has no defined semantics in RFC 9110 and intermediaries are free to drop
 * it. The other portable shape, `DELETE /admin/tiers/:amount`, would put the amount in a
 * path param - and path params are raw strings with no schema behind them, so the "is this
 * a positive integer" check would move out of the contract and into the handler. As a query
 * param it stays validated at the boundary, which is the point of having a contract.
 */
export const tierAmountQuery = object({ amount: amountQueryField });

/**
 * What happened to a removal request. `deactivated` is not a failure: a tier with codes or
 * orders behind it keeps its row so that history still explains what someone paid.
 */
export const tierRemoval = object({
    outcome: union([literal('deleted'), literal('deactivated'), literal('missing')])
});

export type TierRow = Infer<typeof tierRow>;

/**
 * The catalogue's routes. They join the `admin` group in ../../contract.ts - the group is
 * the client's call path (`client.admin.tiers()`) and stays stable while the declarations
 * live with the feature that owns them.
 */
export const catalogueRoutes = {
    tiers: get('/admin/tiers', { output: tierList }),
    saveTier: post('/admin/tiers', { input: tierRow, output: tierList }),
    removeTier: del('/admin/tiers', { query: tierAmountQuery, output: tierRemoval })
};
