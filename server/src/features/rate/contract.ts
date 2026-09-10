// The tether rate's wire shapes: the one the shop sees, and the one the console sees.
//
// THE SHOP'S COPY TRAVELS INSIDE THE CATALOGUE, not on a route of its own. That is
// deliberate: the prices and the rate they were computed from have to be the same fetch, or a
// page can show a rate from one moment beside a price from another and be quietly lying about
// arithmetic the reader can do in their head.
//
// The console's copy is a separate route because it changes every minute and the settings
// page is loaded once.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get } from '../../platform/contract.ts';

/**
 * The rate the shop is pricing with. Present only when two exchanges have agreed recently;
 * a null in its place is the shop saying it cannot price anything, which the cards show.
 */
export const tetherRate = z.object({
    /** One USDT in Toman. */
    toman: z.number().int(),

    /** When the exchanges agreed. The page turns this into «چند دقیقه پیش». */
    at: z.string(),

    /** Older than a few refresh cycles. Still sellable; the ticker says so rather than hiding it. */
    stale: z.boolean()
});

/** One exchange's last answer, named, so the console can say WHICH source is failing. */
export const rateReading = z.object({
    name: z.string(),
    toman: z.number().int().nullable(),
    reason: z.string()
});

/** Everything behind "why is the shop shut". */
export const rateStatus = z.object({
    rate: tetherRate.nullable(),

    /** Whether a card can be bought this second. */
    selling: z.boolean(),

    /** Empty while healthy; otherwise the Persian reason the console displays. */
    reason: z.string(),

    ageSeconds: z.number().int().nullable(),
    readings: z.array(rateReading),
    spreadPercent: z.number().nullable(),

    /** The markup in force, echoed here so the console can show rate and margin together. */
    marginPercent: z.number()
});

export type TetherRateView = z.infer<typeof tetherRate>;
export type RateStatusView = z.infer<typeof rateStatus>;

/** This feature's one route. It joins the `admin` group in ../../contract/index.ts. */
export const rateRoutes = {
    rate: get('/admin/rate', { output: rateStatus })
};
