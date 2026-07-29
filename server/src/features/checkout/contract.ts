// The shop's half of the contract: the catalogue, starting a purchase, and reading the
// receipt. Pairs with routes/pay.ts - the shapes here, the handlers there.
//
// Scope note: no route here accepts card details. The buyer types a phone number, the
// gateway takes the money on its own page, and this server never sees a card number.
import { get, post } from '@azerothjs/http/api/client';
import { array, boolean, literal, number, object, string, union, type Infer } from '@azerothjs/schema';

import { phoneField } from '../../domain/phone.ts';
import { amountField } from '../../contract/shared.ts';

/**
 * What starts a purchase. The SAME schema validates three times from this one declaration:
 * in the browser form before the wire, in the typed client pre-flight, and at the server
 * boundary - so a forged request gets a 422 whose field map the form displays directly.
 */
export const payStartInput = object({
    amount: amountField,
    phone: phoneField
});

/** The form half of {@link payStartInput}: the one field a human types. */
export const purchaseFormInput = object({ phone: phoneField });

/**
 * Where to send the buyer. The server returns the gateway URL rather than answering with a
 * redirect, because the call is fetch-driven: a 30x here would be followed by fetch itself
 * and the buyer would never leave the page.
 */
export const payStartOutput = object({ payUrl: string() });

/**
 * The live shop. Two things here cannot be baked into a prerendered page: the Toman price
 * (it lives in server config and moves with the exchange rate) and the availability (it is
 * whatever is left in the code inventory this second).
 */
export const catalog = object({
    /** What the shop calls itself. Public: it is the page title and the brand on every page. */
    appName: string(),

    tiers: array(object({
        amount: amountField,
        toman: number({ int: true }),
        available: number({ int: true }),

        // The card's own words. They live in the database because the catalogue is editable,
        // so a tier added this afternoon arrives with its copy rather than as a blank card.
        title: string(),
        blurb: string(),
        sample: string(),
        recommended: boolean()
    }))
});

/**
 * How the browser asks what happened. The token identifies ONE completed attempt; the code
 * itself never travels as a query parameter, so it stays out of browser history, out of
 * shoulder-view in the address bar, and out of any referrer header the page emits.
 */
export const receiptQuery = object({ token: string({ trim: true, max: 40 }) });

/**
 * The outcome, in the three shapes a buyer can actually land in.
 * `cancelled` is a person changing their mind at the gateway, which is not an error and
 * must not be dressed as one; `failed` is money that did not verify.
 */
export const receipt = object({
    outcome: union([literal('paid'), literal('cancelled'), literal('failed')]),
    amount: amountField,
    toman: number({ int: true }),

    /** Display form (`09...`), so the buyer recognises the number they typed. */
    phone: string(),

    /** The gift code. Non-null only when `outcome` is `paid`. */
    code: string().nullable(),

    /** The gateway's transaction reference, quoted in support. */
    refId: number({ int: true }).nullable(),

    /** False means the SMS did not go out. It never means the code is invalid. */
    smsDelivered: boolean()
});

export type PayStartInput = Infer<typeof payStartInput>;
export type Catalog = Infer<typeof catalog>;
export type Receipt = Infer<typeof receipt>;

/** The shop's routes. Assembled into the whole contract by ./index.ts. */
export const checkoutRoutes = {
    catalog: get('/pay/catalog', { output: catalog }),
    start: post('/pay/start', { input: payStartInput, output: payStartOutput }),
    receipt: get('/pay/receipt', { query: receiptQuery, output: receipt })
};
