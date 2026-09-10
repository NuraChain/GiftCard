// The shop's half of the contract: the catalogue, starting a purchase, and reading the
// receipt. Pairs with ./routes.ts - the shapes here, the handlers there.
//
// Scope note: no route here accepts card details. The buyer types an email address, the
// gateway takes the money on its own page, and this server never sees a card number.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';
import { emailField } from '../../domain/email.ts';
import { amountField } from '../../contract/shared.ts';
import { tetherRate } from '../rate/contract.ts';

/**
 * What starts a purchase. The SAME schema validates three times from this one declaration:
 * in the browser form before the wire, in the typed client pre-flight, and at the server
 * boundary - so a forged request gets a 422 whose field map the form displays directly.
 */
export const payStartInput = z.object({
    amount: amountField,
    email: emailField,

    /**
     * THE PRICE THE CARD WAS SHOWING when the buyer pressed pay.
     *
     * It is not what they are charged - the server works that out from its own rate and its
     * own margin, the same way it always took the amount from its own tier row. This is an
     * ASSERTION to check that number against: if the tether moved between the page loading
     * and the button being pressed, the two disagree and the purchase is refused rather than
     * silently taking a different sum from the one on screen.
     *
     * So it is a promise the client makes about what it displayed, and the server's only use
     * for it is to call the client wrong. Treating it as the amount would be the oldest
     * mistake in online payments.
     */
    quotedToman: z.number().int().min(1)
});

/**
 * The form half of {@link payStartInput}: the one field a human types.
 *
 * There is one of these per CARD now. The email input lives inside the card the buyer is
 * choosing, so the amount is never in question - it is the card the input sits in.
 */
export const purchaseFormInput = z.object({ email: emailField });

/**
 * Where to send the buyer. The server returns the gateway URL rather than answering with a
 * redirect, because the call is fetch-driven: a 30x here would be followed by fetch itself
 * and the buyer would never leave the page.
 */
export const payStartOutput = z.object({ payUrl: z.string() });

/**
 * The live shop. Two things here cannot be baked into a built page: the Toman price (the
 * operator moves it with the exchange rate) and the availability (it is whatever is left in
 * the code inventory this second).
 */
export const catalog = z.object({
    /** What the shop calls itself. Public: it is the page title and the brand on every page. */
    appName: z.string(),

    /**
     * The live tether rate every price below was computed from, or NULL when no two exchanges
     * agree and the shop cannot price anything.
     *
     * It ships WITH the prices rather than on its own route so the page can never show a rate
     * from one moment beside a price from another - the reader can do that multiplication in
     * their head, and being caught out by it is not a good look for a shop.
     */
    rate: tetherRate.nullable(),

    tiers: z.array(
        z.object({
            amount: amountField,

            /**
             * What this card costs right now. NULL travels with a null `rate` above: there is
             * no last-known price to fall back on, because a price nobody can justify is
             * worse than a card that says it cannot be sold this minute.
             */
            toman: z.number().int().nullable(),

            available: z.number().int(),

            // The card's own words. They live in the database because the catalogue is editable,
            // so a tier added this afternoon arrives with its copy rather than as a blank card.
            title: z.string(),
            blurb: z.string(),
            recommended: z.boolean()
        })
    )
});

/**
 * How the browser asks what happened. The token identifies ONE completed attempt; the code
 * itself never travels as a query parameter, so it stays out of browser history, out of
 * shoulder-view in the address bar, and out of any referrer header the page emits.
 */
export const receiptQuery = z.object({ token: z.string().trim().max(40) });

/**
 * The outcome, in the three shapes a buyer can actually land in.
 * `cancelled` is a person changing their mind at the gateway, which is not an error and
 * must not be dressed as one; `failed` is money that did not verify.
 */
export const receipt = z.object({
    outcome: z.enum(['paid', 'cancelled', 'failed']),
    amount: amountField,
    toman: z.number().int(),

    /** The address the code was sent to, so the buyer recognises what they typed. */
    email: z.string(),

    /** The gift code. Non-null only when `outcome` is `paid`. */
    code: z.string().nullable(),

    /** The gateway's transaction reference, quoted in support. */
    refId: z.number().int().nullable(),

    /** False means the email did not go out. It never means the code is invalid. */
    mailDelivered: z.boolean()
});

export type PayStartInput = z.infer<typeof payStartInput>;
export type PurchaseFormInput = z.infer<typeof purchaseFormInput>;
export type Catalog = z.infer<typeof catalog>;
export type Receipt = z.infer<typeof receipt>;

/** The shop's routes. Assembled into the whole contract by ../../contract/index.ts. */
export const checkoutRoutes = {
    catalog: get('/pay/catalog', { output: catalog }),
    start: post('/pay/start', { input: payStartInput, output: payStartOutput }),
    receipt: get('/pay/receipt', { query: receiptQuery, output: receipt })
};
