// NOWPayments, the English shop's gateway: a hosted crypto invoice priced in dollars.
//
// Built the way ./zarinpal.ts and ./zibal.ts are - `fetch` injected, the key read per call, a
// timeout on everything outbound - so read those first. What is written down here is where
// NOWPayments DIFFERS, and every difference is about money:
//
//   1. THE PRICE IS DOLLARS, AT FACE VALUE. A $10 card is a $10 invoice (`price_currency=usd`,
//      `price_amount=10`) and NOWPayments works out the crypto. There is no Toman anywhere on
//      this path, and no rate: the tether rate the Persian shop is priced from does not apply.
//   2. AN INVOICE IS NOT A PAYMENT. The invoice is the page the buyer is sent to; a PAYMENT is
//      made under it once they pick a coin, and they can make several (switch coin, top up
//      an underpayment). With nothing but the API key, a payment can be read by ITS id and an
//      invoice cannot be read at all - listing an invoice's payments takes the account's
//      password. So the order stores the invoice, and the payment ids are LEARNED from what
//      points at them (the IPN, the buyer's return) and kept - see `paymentsFor` below.
//   3. THERE IS NO VERIFY CALL. `verify` reads every known payment with OUR key and checks it
//      is under OUR invoice, for OUR sum - rule 2 in ./checkout.ts, kept here as Zibal keeps it.
//   4. A PAYMENT CAN BE SEEN BEFORE IT IS MONEY. A transfer sits unconfirmed for minutes,
//      sometimes an hour. That is `pending` - neither paid nor refused - and so is every
//      answer that could not be read, and so is an invoice no payment is known for yet.
//      Settling any of those as a failure would hand a paid order's code back to the shelf.
//   5. THE IPN IS A NUDGE, NOT A WITNESS. NOWPayments signs it, and the signature is not
//      checked, because nothing in the body is believed: the route learns WHICH payment to go
//      and read, and `learn` keeps it only if NOWPayments, asked with our key, says it is
//      under the order's invoice. A forged post costs one lookup and changes nothing - see
//      `mountNowPaymentsCallback` in ./routes.ts.
//
// Wire shapes are transcribed from NOWPayments' published reference (the Postman collection:
// "Create invoice", "Get payment status"). They have NOT been checked against a live account
// from this code; the first real invoice is still the first real invoice.
import type { Fetch, RequestResult, VerifyResult } from './zarinpal.ts';
import type { Answer } from './wire.ts';
import { getJson, postJson, quote, refusal } from './wire.ts';

export interface NowPaymentsOptions {
    /** Read PER CALL: the key and the host are editable from the console. */
    settings: () => { apiKey: string; baseUrl: string };

    /**
     * The payment ids already learned for an invoice - rule 2. The store holds them, so a
     * restart forgets nothing the reconciler needs.
     */
    paymentsFor: (invoiceId: string) => Promise<string[]>;

    fetch?: Fetch;

    /** Outbound timeout. A gateway that hangs must not hang the buyer's request. */
    timeoutMs?: number;
}

/** What opening an invoice needs. Everything the buyer sees on NOWPayments' page comes from here. */
export interface NowPaymentsRequest {
    /** The card's face value, in dollars. */
    usdAmount: number;

    /**
     * A number unique to each order. It is a fresh random one, NOT the receipt token - the
     * token reads the code back, and has no business in a third party's reports. It is the
     * reference the buyer quotes in support.
     */
    orderNumber: number;

    /** What the invoice page calls the purchase. */
    orderName: string;

    /** Where NOWPayments posts a payment's state - the nudge, see rule 5. */
    callbackUrl: string;

    /** Where the invoice page sends the buyer, paid or not. */
    returnUrl: string;
}

/** What the English shop depends on: open an invoice, learn its payments, and read them back. */
export interface NowPayments {
    request(input: NowPaymentsRequest): Promise<RequestResult>;

    /**
     * Whether `paymentId` is a payment under `invoiceId`, asked of NOWPayments with our key.
     * Only a `true` here may be stored as one of the invoice's payments.
     */
    learn(invoiceId: string, paymentId: string): Promise<boolean>;

    /**
     * The invoice a payment is under, as NOWPayments says it with our key, or null when it
     * cannot say. An IPN can arrive with its `invoice_id` missing or null; the payment id is then
     * the only way back to the order, and this is how it is spent.
     */
    invoiceOf(paymentId: string): Promise<string | null>;

    /** `usdAmount` MUST come from our stored order, never from anything the request carried. */
    verify(invoiceId: string, usdAmount: number): Promise<VerifyResult>;
}

/** Every field this file reads. All optional: it is somebody else's JSON. */
interface NowPaymentsBody {
    // An invoice.
    id?: string | number;
    invoice_url?: string;

    // A payment. The ids come back as numbers here and as strings elsewhere.
    payment_id?: string | number;
    invoice_id?: string | number | null;
    payment_status?: string;
    price_amount?: string | number;
    price_currency?: string;

    // A refusal.
    statusCode?: number;
    code?: string;
    message?: string;
}

/** The one state that means the money arrived and is ours. */
const PAID = 'finished';

/**
 * The states that mean this payment never will. One dead payment does not kill an invoice:
 * the buyer may have switched coin and paid under a second payment.
 */
const DEAD = new Set(['failed', 'expired', 'refunded']);

/** @internal An id that is safe to put in a path. NOWPayments' are digits; anything else is not ours. */
export const ID_SHAPE = /^\d{1,20}$/;

/** @internal An id out of a number or a numeric string, as a string, or ''. */
function idOf(raw: unknown): string {
    const text = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
    return typeof text === 'string' && ID_SHAPE.test(text) ? text : '';
}

/** @internal Why NOWPayments said no. */
function why(answer: Answer<NowPaymentsBody>): string {
    return refusal(answer, answer.body?.code ?? answer.body?.statusCode, answer.body?.message);
}

export function createNowPayments(options: NowPaymentsOptions): NowPayments {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 15_000;

    /**
     * The address of one endpoint, or null. An unusable host from the console is an ANSWER -
     * the same "no answer" a dead host gives - never a throw into the buyer's request.
     */
    function endpoint(path: string): string | null {
        try {
            return new URL(`${options.settings().baseUrl}/v1/${path}`).href;
        } catch {
            return null;
        }
    }

    const NO_HOST: Answer<NowPaymentsBody> = {
        body: null,
        status: null,
        trouble: 'no answer: the NOWPayments host is not a valid URL'
    };

    function headers(): Record<string, string> {
        return { 'x-api-key': options.settings().apiKey };
    }

    /** One payment, read with our key. */
    function readPayment(paymentId: string): Promise<Answer<NowPaymentsBody>> {
        const url = endpoint(`payment/${paymentId}`);
        return url === null
            ? Promise.resolve(NO_HOST)
            : getJson<NowPaymentsBody>(call, url, timeoutMs, headers());
    }

    return {
        async request(input) {
            if (options.settings().apiKey === '') {
                return { ok: false, reason: 'nowpayments: no API key is set' };
            }
            const url = endpoint('invoice');
            const answer =
                url === null
                    ? NO_HOST
                    : await postJson<NowPaymentsBody>(
                          call,
                          url,
                          {
                              price_amount: input.usdAmount,
                              price_currency: 'usd',
                              order_id: String(input.orderNumber),
                              order_description: input.orderName,
                              ipn_callback_url: input.callbackUrl,
                              success_url: input.returnUrl,
                              cancel_url: input.returnUrl,
                              partially_paid_url: input.returnUrl
                          },
                          timeoutMs,
                          headers()
                      );

            const invoiceId = idOf(answer.body?.id);
            const payUrl = answer.body?.invoice_url;
            if (answer.status === null || answer.status >= 300) {
                return { ok: false, reason: `nowpayments: request failed (${why(answer)})` };
            }
            if (invoiceId === '' || typeof payUrl !== 'string') {
                return { ok: false, reason: 'nowpayments: invoice created without a usable id' };
            }
            return { ok: true, authority: invoiceId, payUrl };
        },

        async learn(invoiceId, paymentId) {
            if (!ID_SHAPE.test(invoiceId) || !ID_SHAPE.test(paymentId)) {
                return false;
            }
            const answer = await readPayment(paymentId);
            return answer.status === 200 && idOf(answer.body?.invoice_id) === invoiceId;
        },

        async invoiceOf(paymentId) {
            if (!ID_SHAPE.test(paymentId)) {
                return null;
            }
            const answer = await readPayment(paymentId);
            const invoiceId = idOf(answer.body?.invoice_id);
            return answer.status === 200 && invoiceId !== '' ? invoiceId : null;
        },

        async verify(invoiceId, usdAmount) {
            if (!ID_SHAPE.test(invoiceId)) {
                return { ok: false, reason: 'nowpayments: verify failed (unreadable invoice id)' };
            }
            const known = (await options.paymentsFor(invoiceId)).filter((id) => ID_SHAPE.test(id));
            if (known.length === 0) {
                // Rule 4: the buyer has not picked a coin yet, or we have not been told.
                return { ok: false, pending: true, reason: 'nowpayments: no payment yet' };
            }

            const states: string[] = [];
            for (const paymentId of known) {
                const answer = await readPayment(paymentId);
                const body = answer.body;
                if (answer.status !== 200 || body === null) {
                    // Rule 4: an answer we could not read is not an answer about the payment.
                    return {
                        ok: false,
                        pending: true,
                        reason: `nowpayments: could not read payment ${paymentId} (${why(answer)})`
                    };
                }
                if (idOf(body.invoice_id) !== invoiceId) {
                    // Stored by `learn`, so this is NOWPayments contradicting itself. Not ours to
                    // settle on either way.
                    states.push('foreign');
                    continue;
                }

                const state = typeof body.payment_status === 'string' ? body.payment_status : '';
                if (state === PAID) {
                    const charged = Number(body.price_amount);
                    if (
                        body.price_currency?.toLowerCase() !== 'usd' ||
                        Math.abs(charged - usdAmount) > 0.001
                    ) {
                        return {
                            ok: false,
                            reason: `nowpayments: payment is for a different sum (${quote(
                                `${String(body.price_amount)} ${String(body.price_currency)} against our ${usdAmount} usd`
                            )})`
                        };
                    }
                    // The payment id is the reference: an exact integer, and the one
                    // NOWPayments' own panel finds the payment by.
                    return { ok: true, refId: Number(paymentId), alreadyVerified: false };
                }
                states.push(state === '' ? 'without a status' : state);
            }

            // Every known payment is over and none of them paid: the invoice is dead. Anything
            // still moving - waiting, confirming, sending, partially_paid - keeps it pending.
            // `partially_paid` is NEVER delivered automatically: the buyer sent less than the
            // price, and it is the operator's call from NOWPayments' panel.
            if (states.every((state) => DEAD.has(state))) {
                return { ok: false, reason: `nowpayments: payment ${quote(states.join(', '))}` };
            }
            return {
                ok: false,
                pending: true,
                reason: `nowpayments: payment ${quote(states.join(', '))}`
            };
        }
    };
}
