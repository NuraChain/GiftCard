// THE shared API contract - one declaration, both sides of the wire.
//
// The server mounts it (app.ts: mountApi) and the application imports it for the fully
// inferred client (application/src/api.ts). This file is CLIENT-SAFE by construction:
// it imports only the browser entry of the contract layer, the isomorphic schema package,
// and the phone rules - so bundling it into the application drags in zero server code.
//
// Scope note: no route here accepts card details. The buyer types a phone number, the
// gateway takes the money on its own page, and this server never sees a card number.
import { defineContract, route } from '@azerothjs/http/api/client';
import { array, boolean, literal, number, object, string, union, type Infer } from '@azerothjs/schema';

import { phoneField } from './domain/phone.ts';

/**
 * A denomination, in dollars. This USED to be `union([literal(5), literal(10), literal(25)])`,
 * which made "an unlisted amount is a forged request" a compile-time and wire-time fact.
 *
 * The catalogue is editable now, so the valid set is a database table and the schema can only
 * check the shape. THE RULE DID NOT GO AWAY WITH THE TYPE: `pay.start` looks the amount up in
 * the live tier table and refuses anything missing or inactive, before a code is claimed or a
 * gateway is called. Read that handler alongside this line - it is where the union went.
 */
export const amountField = number({ int: true, min: 1, max: 100_000 });

/** The same field arriving through a query string, where everything is text. */
export const amountQueryField = number({ int: true, min: 1, max: 100_000, coerce: true });

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

// --- The console ---
//
// Everything below sits behind the admin session. The KEY is only ever sent in a request
// body, never a query string: a URL lands in browser history, server logs and referrer
// headers, and a credential must be in none of those.

export const adminKeyInput = object({ key: string({ trim: true, max: 32 }) });

/** One denomination's inventory. `held` is reserved by a checkout that has not settled. */
export const stockLine = object({
    amount: amountField,
    available: number({ int: true }),
    held: number({ int: true }),
    sold: number({ int: true })
});

/**
 * A ledger row. It carries the full phone and the delivered code because that is what
 * answering a support call requires - and it is exactly why this endpoint is behind a
 * session and this page is not indexed.
 */
export const ledgerRow = object({
    id: string(),
    amount: amountField,
    toman: number({ int: true }),
    phone: string(),
    status: union([literal('pending'), literal('paid'), literal('cancelled'), literal('failed')]),
    code: string().nullable(),
    refId: number({ int: true }).nullable(),
    smsDelivered: boolean(),
    createdAt: string()
});

export const adminOverview = object({
    stock: array(stockLine),

    /** Paid orders with no code: money taken, nothing delivered. The count that needs a human. */
    owed: number({ int: true })
});

/**
 * One page of the ledger. `search` is one box, not four: an operator holding a phone call
 * has the customer's number, or a code, or a reference - and should not have to know which
 * field the system files it under.
 */
export const ledgerQuery = object({
    search: string({ trim: true, max: 64 }).optional(),
    // A query string carries text, so the page number arrives as one: `coerce` is what
    // makes `?page=2` a number rather than a 422.
    page: number({ int: true, min: 1, coerce: true }).optional()
});

export const ledgerPage = object({
    rows: array(ledgerRow),

    /** Rows matching the search, across every page - what the page counter divides. */
    total: number({ int: true }),
    page: number({ int: true }),
    pageSize: number({ int: true })
});

/**
 * One code in the inventory, and where it went. This is the audit view: what was loaded,
 * what is still sellable, and which buyer holds which code.
 */
export const codeRow = object({
    code: string(),
    amount: amountField,
    state: union([literal('free'), literal('held'), literal('sold')]),
    addedAt: string(),
    phone: string().nullable(),
    soldAt: string().nullable(),
    refId: number({ int: true }).nullable()
});

export const codeQuery = object({
    search: string({ trim: true, max: 64 }).optional(),
    state: union([literal('free'), literal('held'), literal('sold')]).optional(),
    amount: amountQueryField.optional(),
    page: number({ int: true, min: 1, coerce: true }).optional()
});

export const codePage = object({
    rows: array(codeRow),
    total: number({ int: true }),
    page: number({ int: true }),
    pageSize: number({ int: true })
});

export const addCodesInput = object({
    amount: amountField,
    codes: array(string({ trim: true, max: 64 }), { max: 500 })
});

/** Every pasted line is accounted for; `invalid` returns the bad ones verbatim to be fixed. */
export const addCodesResult = object({
    added: number({ int: true }),
    duplicate: number({ int: true }),
    invalid: array(string())
});

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

export const tierAmountInput = object({ amount: amountField });

/**
 * What happened to a removal request. `deactivated` is not a failure: a tier with codes or
 * orders behind it keeps its row so that history still explains what someone paid.
 */
export const tierRemoval = object({
    outcome: union([literal('deleted'), literal('deactivated'), literal('missing')])
});

// --- Settings ---
//
// A secret is WRITE-ONLY across this boundary. The console may replace the merchant id or
// the SMS key, and may see whether one is set and its last four characters - never the value.
// A stolen session must not be a way to read out the credentials it can overwrite.

export const settingsView = object({
    appName: string(),

    /** The gateway host in use, and whether it is the sandbox one. */
    zarinpalBase: string(),
    sandbox: boolean(),

    /** `••••5555`, or an empty string when nothing is configured. */
    merchantIdMasked: string(),
    merchantIdSet: boolean(),

    kavenegarKeyMasked: string(),
    kavenegarKeySet: boolean(),
    kavenegarTemplate: string(),
    kavenegarBase: string(),

    /** Delivery only runs when both the key and the template are present. */
    smsReady: boolean(),

    /** Read-only, from the environment: where the gateway returns the buyer. */
    callbackUrl: string(),

    /** True once the admin key has been rotated into the database. */
    keyRotated: boolean()
});

/**
 * Every field is optional: the console sends only what changed, so leaving a secret blank
 * means "keep it" rather than "erase it". Erasing is an explicit empty-string write.
 */
export const settingsInput = object({
    appName: string({ trim: true, max: 60 }).optional(),
    zarinpalBase: string({ trim: true, max: 200 }).optional(),
    merchantId: string({ trim: true, max: 100 }).optional(),
    kavenegarKey: string({ trim: true, max: 200 }).optional(),
    kavenegarTemplate: string({ trim: true, max: 100 }).optional(),
    kavenegarBase: string({ trim: true, max: 200 }).optional()
});

/** One recorded change. Values are masked here too - the log is not a way around write-only. */
export const settingsLogRow = object({
    key: string(),
    before: string(),
    after: string(),
    changedAt: string()
});

export const settingsLog = object({ entries: array(settingsLogRow) });

/**
 * Rotating demands the CURRENT key even though a session is already open. A session proves
 * someone was the admin at sign-in; replacing the credential should prove they still are.
 */
export const rotateKeyInput = object({
    currentKey: string({ trim: true, max: 32 }),
    newKey: string({ trim: true, max: 32 })
});

/** Proving a Kavenegar template is approved without selling something first. */
export const testSmsInput = object({ phone: phoneField });
export const testSmsResult = object({ ok: boolean(), reason: string() });

export type PayStartInput = Infer<typeof payStartInput>;
export type Catalog = Infer<typeof catalog>;
export type Receipt = Infer<typeof receipt>;
export type AdminOverview = Infer<typeof adminOverview>;
export type LedgerPage = Infer<typeof ledgerPage>;
export type LedgerRow = Infer<typeof ledgerRow>;
export type CodePage = Infer<typeof codePage>;
export type CodeRow = Infer<typeof codeRow>;
export type StockLine = Infer<typeof stockLine>;
export type AddCodesResult = Infer<typeof addCodesResult>;
export type TierRow = Infer<typeof tierRow>;
export type SettingsView = Infer<typeof settingsView>;
export type SettingsLogRow = Infer<typeof settingsLogRow>;

export const contract = defineContract({
    pay: {
        catalog: route({ method: 'GET', path: '/pay/catalog', output: catalog }),
        start: route({ method: 'POST', path: '/pay/start', input: payStartInput, output: payStartOutput }),
        receipt: route({ method: 'GET', path: '/pay/receipt', query: receiptQuery, output: receipt })
    },
    admin: {
        signIn: route({ method: 'POST', path: '/admin/session', input: adminKeyInput }),
        signOut: route({ method: 'DELETE', path: '/admin/session' }),
        overview: route({ method: 'GET', path: '/admin/overview', output: adminOverview }),
        orders: route({ method: 'GET', path: '/admin/orders', query: ledgerQuery, output: ledgerPage }),
        addCodes: route({ method: 'POST', path: '/admin/codes', input: addCodesInput, output: addCodesResult }),
        codes: route({ method: 'GET', path: '/admin/codes', query: codeQuery, output: codePage }),

        tiers: route({ method: 'GET', path: '/admin/tiers', output: tierList }),
        saveTier: route({ method: 'POST', path: '/admin/tiers', input: tierRow, output: tierList }),
        removeTier: route({ method: 'DELETE', path: '/admin/tiers', input: tierAmountInput, output: tierRemoval }),

        settings: route({ method: 'GET', path: '/admin/settings', output: settingsView }),
        saveSettings: route({ method: 'POST', path: '/admin/settings', input: settingsInput, output: settingsView }),
        settingsLog: route({ method: 'GET', path: '/admin/settings/log', output: settingsLog }),
        rotateKey: route({ method: 'POST', path: '/admin/key', input: rotateKeyInput }),
        testSms: route({ method: 'POST', path: '/admin/test-sms', input: testSmsInput, output: testSmsResult })
    }
});
