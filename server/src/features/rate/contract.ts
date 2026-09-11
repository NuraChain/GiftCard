// The tether rate's wire shapes: the one the shop sees, and the one the console sees.
//
// THE SHOP'S COPY TRAVELS INSIDE THE CATALOGUE, not on a route of its own. That is
// deliberate: the prices and the rate they were computed from have to be the same fetch, or a
// page can show a rate from one moment beside a price from another and be quietly lying about
// arithmetic the reader can do in their head.
//
// The console's copy is a separate route because the pricing panel wants the age and the
// margin together, and because the storefront has no business being told why the shop is shut.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get } from '../../platform/contract.ts';

/**
 * The rate the shop is pricing with. Present only once the console has set one; a null in its
 * place is the shop saying it cannot price anything, which the cards show.
 */
export const tetherRate = z.object({
    /** One USDT in Toman. */
    toman: z.number().int(),

    /** When the console set it. The page turns this into «چند ساعت پیش». */
    at: z.string(),

    /** Older than a working day's drift. Still sellable; the ticker says so rather than hiding it. */
    stale: z.boolean()
});

/** Everything behind "why is the shop shut". */
export const rateStatus = z.object({
    rate: tetherRate.nullable(),

    /** Whether a card can be bought this second. */
    selling: z.boolean(),

    /** Empty while healthy; otherwise the Persian reason the console displays. */
    reason: z.string(),

    ageSeconds: z.number().int().nullable(),

    /** The markup in force, echoed here so the console can show rate and margin together. */
    marginPercent: z.number()
});

export type TetherRateView = z.infer<typeof tetherRate>;
export type RateStatusView = z.infer<typeof rateStatus>;

/** This feature's one route. It joins the `admin` group in ../../contract/index.ts. */
export const rateRoutes = {
    rate: get('/admin/rate', { output: rateStatus })
};
