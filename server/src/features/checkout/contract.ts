// The shop's half of the contract: the catalogue, starting a purchase, and reading the
// receipt. Pairs with ./routes.ts - the shapes here, the handlers there.
//
// Scope note: no route here accepts card details. The buyer types a mobile number (or, in
// the English shop, an email address), the gateway takes the money on its own page, and this
// server never sees a card number or a wallet key.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { INTL_LANGS, type IntlLang } from '../../domain/langs.ts';
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';
import { emailField } from '../../domain/email.ts';
import { phoneField } from '../../domain/phone.ts';
import { amountField } from '../../contract/shared.ts';

/**
 * What starts a purchase. The SAME schema validates three times from this one declaration:
 * in the browser form before the wire, in the typed client pre-flight, and at the server
 * boundary - so a forged request gets a 422 whose field map the form displays directly.
 */
export const payStartInput = z.object({
    amount: amountField,
    phone: phoneField,

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
 * There is one of these per CARD now. The mobile input lives inside the card the buyer is
 * choosing, so the amount is never in question - it is the card the input sits in.
 */
export const purchaseFormInput = z.object({ phone: phoneField });

/**
 * Where to send the buyer. The server returns the gateway URL rather than answering with a
 * redirect, because the call is fetch-driven: a 30x here would be followed by fetch itself
 * and the buyer would never leave the page.
 */
export const payStartOutput = z.object({ payUrl: z.string() });

/**
 * What starts a purchase in the ENGLISH shop. A separate route rather than a flag on the one
 * above, because almost nothing is shared: the buyer gives an email rather than a mobile, the
 * price is the face value in dollars - so there is no quote to assert, nothing moves it - and
 * the gateway is always Plisio, whichever one the Persian shop is using.
 */
export const payStartEnInput = z.object({
    amount: amountField,
    email: emailField,

    /**
     * Which page Plisio sends the buyer back to. One of a fixed list, so the request can pick
     * a language but never write the address. Absent means English - a page loaded before
     * there were other languages does not send it.
     */
    lang: z.enum(INTL_LANGS).default('en')
});

/** The English card's form: the one field a human types. */
export const purchaseEnFormInput = z.object({ email: emailField });

/**
 * As above, plus the receipt token. Plisio's page sends the buyer back to a fixed address
 * that cannot name the order (the token is not given to Plisio - it reads the code back), so
 * the browser keeps the token for the trip and asks about it on return. It is the buyer's own
 * receipt, going to the buyer's own browser.
 */
export const payStartEnOutput = z.object({ payUrl: z.string(), receipt: z.string() });

/**
 * The live shop. Two things here cannot be baked into a built page: the Toman price (the
 * operator moves it with the tether rate) and the availability (it is whatever is left in
 * the code inventory this second).
 */
export const catalog = z.object({
    /** What the shop calls itself. Public: it is the page title and the brand on every page. */
    appName: z.string(),

    /** The name in each dollar-shop language, empty where unset. See `shopName`. */
    appNames: z.object(
        Object.fromEntries(INTL_LANGS.map((lang) => [lang, z.string()])) as Record<
            IntlLang,
            z.ZodString
        >
    ),

    // NO RATE HERE, DELIBERATELY. The shop used to publish the tether rate it priced from,
    // back when that rate was read live off two exchanges and the number was a fact the buyer
    // could check. It is set by hand now, so showing it would be publishing an internal
    // setting dressed as a market quote. What a buyer needs is the price, and `toman` below is
    // the price - a null there still means "cannot be bought", exactly as it did.

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

            /** The English shop's copy. Empty means the page words the card from its amount. */
            titleEn: z.string(),
            blurbEn: z.string(),
            recommended: z.boolean()
        })
    ),

    /**
     * Whether the English shop can take a payment: Plisio has a key. The English cards are
     * priced at face value, so this - not the tether rate - is what closes them.
     */
    englishOpen: z.boolean()
});

/**
 * How the browser asks what happened. The token identifies ONE completed attempt; the code
 * itself never travels as a query parameter, so it stays out of browser history, out of
 * shoulder-view in the address bar, and out of any referrer header the page emits.
 */
export const receiptQuery = z.object({ token: z.string().trim().max(40) });

/**
 * The outcome, in the shapes a buyer can actually land in.
 * `cancelled` is a person changing their mind at the gateway, which is not an error and
 * must not be dressed as one; `failed` is money that did not verify. `pending` is reported
 * for an ENGLISH order only: a crypto payment confirming on the chain is a state worth showing,
 * whereas a Persian order that has not come back from the bank is still nothing to report.
 */
export const receipt = z.object({
    outcome: z.enum(['paid', 'cancelled', 'failed', 'pending']),
    amount: amountField,

    /** Zero on an English order, which was charged `amount` in dollars. */
    toman: z.number().int(),

    lang: z.enum(['fa', 'en']),

    /**
     * Where the code was sent, so the buyer recognises what they typed: the mobile number,
     * or on an English order the email address.
     */
    phone: z.string(),

    /** The gift code. Non-null only when `outcome` is `paid`. */
    code: z.string().nullable(),

    /** The gateway's transaction reference, quoted in support. */
    refId: z.number().int().nullable(),

    /** False means the SMS (or email) did not go out. It never means the code is invalid. */
    smsDelivered: z.boolean()
});

export type PayStartInput = z.infer<typeof payStartInput>;
export type PurchaseFormInput = z.infer<typeof purchaseFormInput>;
export type PayStartEnInput = z.infer<typeof payStartEnInput>;
export type Catalog = z.infer<typeof catalog>;
export type Receipt = z.infer<typeof receipt>;

/** The shop's routes. Assembled into the whole contract by ../../contract/index.ts. */
export const checkoutRoutes = {
    catalog: get('/pay/catalog', { output: catalog }),
    start: post('/pay/start', { input: payStartInput, output: payStartOutput }),
    startEn: post('/pay/start-en', { input: payStartEnInput, output: payStartEnOutput }),
    receipt: get('/pay/receipt', { query: receiptQuery, output: receipt })
};
