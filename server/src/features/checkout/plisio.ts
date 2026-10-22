// Plisio, the English shop's gateway: a crypto invoice priced in dollars.
//
// Built the way ./zarinpal.ts and ./zibal.ts are - `fetch` injected, the key read per call, a
// timeout on everything outbound - so read those first. What is written down here is where
// Plisio DIFFERS, and every difference is about money:
//
//   1. THE PRICE IS DOLLARS, AT FACE VALUE. A $10 card is a $10 invoice (`source_currency=USD`,
//      `source_amount=10`) and Plisio works out the crypto. There is no Toman anywhere on this
//      path, and no rate: the tether rate the Persian shop is priced from does not apply.
//   2. THERE IS NO VERIFY CALL. Zarinpal and Zibal confirm a payment when asked to; Plisio
//      reports what an invoice's state IS, through `operations/<txn_id>`. So `verify` reads
//      that state with OUR key, and checks the answer was for OUR sum - rule 2 in
//      ./checkout.ts, kept here exactly as Zibal keeps it.
//   3. A PAYMENT CAN BE SEEN BEFORE IT IS MONEY. A crypto transfer sits unconfirmed for
//      minutes, sometimes an hour. That is `pending` - neither paid nor refused - and so is
//      every answer that could not be read: a Plisio that cannot be reached says nothing about
//      whether the buyer paid, and settling it as a failure would hand a paid order's code back
//      to the shelf.
//   4. THE CALLBACK IS A NUDGE, NOT A WITNESS. Plisio posts the invoice state to us, signed
//      with an HMAC. The signature is not checked, because nothing in the body is believed:
//      the route only learns WHICH invoice to go and ask about. A forged post costs one
//      lookup and changes nothing - see `mountPlisioCallback` in ./routes.ts.
//   5. THE API KEY TRAVELS IN THE QUERY STRING, because that is Plisio's API. No reason built
//      here contains a URL, and the logger never sees one - see `getJson` in ./wire.ts.
//
// Wire shapes are transcribed from Plisio's published reference (plisio.net/documentation:
// "Create an invoice" and "Transaction details"). They have NOT been checked against a live
// account from this code; the first real invoice is still the first real invoice.
import type { Fetch, RequestResult, VerifyResult } from './zarinpal.ts';
import type { Answer } from './wire.ts';
import { getJson, quote, refusal } from './wire.ts';

export interface PlisioOptions {
    /** Read PER CALL: the key and the host are editable from the console. */
    settings: () => { apiKey: string; baseUrl: string };

    fetch?: Fetch;

    /** Outbound timeout. A gateway that hangs must not hang the buyer's request. */
    timeoutMs?: number;
}

/** What opening an invoice needs. Everything the buyer sees on Plisio's page comes from here. */
export interface PlisioRequest {
    /** The card's face value, in dollars. */
    usdAmount: number;

    /**
     * Plisio requires a number unique to each order. It is a fresh random one, NOT the receipt
     * token - the token reads the code back, and has no business in a third party's reports.
     * It comes back on the paid invoice and is the reference the buyer quotes in support.
     */
    orderNumber: number;

    /** What the invoice page calls the purchase. */
    orderName: string;

    /** The buyer's address. Passed so Plisio does not ask for it a second time. */
    email: string;

    /** Where Plisio posts the invoice's state - the nudge, see rule 4. */
    callbackUrl: string;

    /** Where the invoice page's buttons send the buyer, paid or not. */
    returnUrl: string;

    /** How long the invoice stays payable. Matches the hold on the code - see ./routes.ts. */
    expireMinutes: number;
}

/** What the English shop depends on: open an invoice, and read one back. */
export interface Plisio {
    request(input: PlisioRequest): Promise<RequestResult>;

    /** `usdAmount` MUST come from our stored order, never from anything the request carried. */
    verify(txnId: string, usdAmount: number): Promise<VerifyResult>;
}

/** Every field this file reads. All optional: it is somebody else's JSON. */
interface PlisioBody {
    status?: string;
    data?: {
        // A successful invoice.
        txn_id?: string;
        invoice_url?: string;

        // A transaction's details.
        status?: string;
        source_currency?: string;
        params?: { source_amount?: number | string; order_number?: number | string };

        // A refusal.
        name?: string;
        message?: string;
        code?: number;
    };
}

/** The invoice states that mean the money arrived. `mismatch` is Plisio's word for overpaid. */
const PAID = new Set(['completed', 'mismatch']);

/**
 * The states that mean it never will, for this invoice. `cancelled duplicate` is deliberately
 * NOT here: it is what Plisio leaves behind when the buyer switched coin and paid a different
 * invoice, and that money is real - so it is left pending for a human rather than settled as
 * a failure.
 */
const DEAD = new Set(['expired', 'cancelled', 'error']);

/** @internal A txn id that is safe to put in a path. Plisio's are hex; anything else is not ours. */
const TXN_SHAPE = /^[0-9a-zA-Z]{1,64}$/;

/** @internal Why Plisio said no, from the `data` its refusals carry. */
function why(answer: Answer<PlisioBody>): string {
    return refusal(answer, answer.body?.data?.code, answer.body?.data?.message);
}

/** @internal A positive safe integer out of a number or a numeric string, or null. */
function wholeNumber(raw: unknown): number | null {
    const parsed = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createPlisio(options: PlisioOptions): Plisio {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 15_000;

    /**
     * One call, with the key appended last. An unusable host from the console is an ANSWER -
     * the same "no answer" a dead host gives - never a throw into the buyer's request.
     */
    function ask(path: string, params: Record<string, string>): Promise<Answer<PlisioBody>> {
        let target: URL;
        try {
            target = new URL(`${options.settings().baseUrl}/api/v1/${path}`);
        } catch {
            return Promise.resolve({
                body: null,
                status: null,
                trouble: 'no answer: the Plisio host is not a valid URL'
            });
        }
        for (const [name, value] of Object.entries(params)) {
            // An empty value is left out rather than sent: Plisio validates what it is given.
            if (value !== '') {
                target.searchParams.set(name, value);
            }
        }
        target.searchParams.set('api_key', options.settings().apiKey);
        return getJson<PlisioBody>(call, target.href, timeoutMs);
    }

    return {
        async request(input) {
            if (options.settings().apiKey === '') {
                return { ok: false, reason: 'plisio: no API key is set' };
            }
            const answer = await ask('invoices/new', {
                source_currency: 'USD',
                source_amount: String(input.usdAmount),
                order_number: String(input.orderNumber),
                order_name: input.orderName,
                email: input.email,
                callback_url: input.callbackUrl,
                success_invoice_url: input.returnUrl,
                fail_invoice_url: input.returnUrl,
                expire_min: String(input.expireMinutes),
                language: 'en_US'
            });

            if (answer.body?.status !== 'success') {
                return { ok: false, reason: `plisio: request failed (${why(answer)})` };
            }
            const txnId = answer.body.data?.txn_id;
            const payUrl = answer.body.data?.invoice_url;
            if (typeof txnId !== 'string' || !TXN_SHAPE.test(txnId) || typeof payUrl !== 'string') {
                return { ok: false, reason: 'plisio: invoice created without a usable txn id' };
            }
            return { ok: true, authority: txnId, payUrl };
        },

        async verify(txnId, usdAmount) {
            if (!TXN_SHAPE.test(txnId)) {
                return { ok: false, reason: 'plisio: verify failed (unreadable txn id)' };
            }
            const answer = await ask(`operations/${txnId}`, {});
            const data = answer.body?.data;
            if (answer.body?.status !== 'success' || data === undefined) {
                // Rule 3: an answer we could not read is not an answer about the payment.
                return {
                    ok: false,
                    pending: true,
                    reason: `plisio: could not read the invoice (${why(answer)})`
                };
            }

            const state = typeof data.status === 'string' ? data.status : '';
            if (PAID.has(state)) {
                const charged = Number(data.params?.source_amount);
                if (data.source_currency !== 'USD' || Math.abs(charged - usdAmount) > 0.001) {
                    return {
                        ok: false,
                        reason: `plisio: invoice is for a different payment (${quote(
                            `${String(data.params?.source_amount)} ${String(data.source_currency)} against our ${usdAmount} USD`
                        )})`
                    };
                }
                // The order number we minted at checkout. A paid invoice without one is still
                // paid - the reference is for support, not for deciding anything.
                return {
                    ok: true,
                    refId: wholeNumber(data.params?.order_number) ?? 0,
                    alreadyVerified: false
                };
            }
            if (DEAD.has(state)) {
                return { ok: false, reason: `plisio: invoice ${quote(state)}` };
            }
            return {
                ok: false,
                pending: true,
                reason: `plisio: invoice ${quote(state === '' ? 'without a status' : state)}`
            };
        }
    };
}
