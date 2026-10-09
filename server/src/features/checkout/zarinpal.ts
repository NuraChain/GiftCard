// Zarinpal, and the shape every gateway here has to fit.
//
// It was the only gateway for long enough that the shared types - `PaymentGateway`, `Fetch`,
// the two result unions - were written in this file and are still imported from it. ./zibal.ts
// is the second client, ./gateway.ts decides which of the two a payment goes to, and ./wire.ts
// is the one POST both of them make.
//
// The framework ships no outbound-HTTP helper, so this is global fetch with an explicit
// timeout - the same shape the sibling Euphoria server uses for its one third-party call.
// `fetch` is INJECTED rather than reached for globally: the framework tests transports by
// injection (see `createClient({ fetch })`), and it is what lets the whole payment flow be
// tested without a network or a merchant account.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the browser's return from the gateway proves
// nothing. `?Status=OK` is a string anyone can type into the address bar. A payment is real
// only when THIS server posts to verify.json with its own merchant id and its own stored
// amount and gets a 100 or 101 back.
import type { Answer } from './wire.ts';
import { postJson, refusal } from './wire.ts';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PaymentOptions {
    /**
     * Read PER CALL, not captured once. The merchant id and the gateway host are editable
     * from the console, and a client built from literals at boot would keep charging the old
     * account until someone restarted the process.
     */
    settings: () => { merchantId: string; baseUrl: string };

    fetch?: Fetch;

    /** Outbound timeout. A gateway that hangs must not hang the buyer's request. */
    timeoutMs?: number;
}

export interface PaymentRequest {
    tomanAmount: number;
    description: string;
    callbackUrl: string;
}

export type RequestResult =
    | { ok: true; authority: string; payUrl: string }
    | { ok: false; reason: string };

export type VerifyResult =
    | { ok: true; refId: number; alreadyVerified: boolean }
    | { ok: false; reason: string };

/**
 * What the app depends on. The app takes THIS, not the concrete client, so a test supplies
 * a two-method object and every payment path runs without a merchant account.
 */
export interface PaymentGateway {
    request(input: PaymentRequest): Promise<RequestResult>;
    verify(authority: string, tomanAmount: number): Promise<VerifyResult>;
}

interface ZarinpalBody {
    data?: { code?: number; authority?: string; ref_id?: number; message?: string };

    /**
     * An empty array on a success. On a REFUSAL it is an object, and the only place the code
     * and the reason are - `data` comes back empty. See `why` below.
     */
    errors?: unknown;
}

/** What `errors` holds when Zarinpal refuses. Every field unproven: it is somebody else's JSON. */
interface ZarinpalErrors {
    code?: unknown;
    message?: unknown;

    /** One entry per rejected field on a -9, each naming the field and what is wrong with it. */
    validations?: unknown;
}

/**
 * @internal Why Zarinpal said no: the code and message out of `errors`, with the per-field
 * list a validation refusal carries, or - when no answer was read at all - what the wire did.
 *
 * THIS READS `errors.code`, AND NOTHING THAT DECIDES A PAYMENT DOES. Whether money moved is
 * `data.code` alone, in `request` and `verify` below; this only words a refusal for the log.
 */
function why(answer: Answer<ZarinpalBody>): string {
    const raw = answer.body?.errors;
    const errors: ZarinpalErrors =
        typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    const said = [errors.message ?? answer.body?.data?.message].filter(
        (part) => typeof part === 'string'
    );
    if (Array.isArray(errors.validations) && errors.validations.length > 0) {
        said.push(JSON.stringify(errors.validations));
    }
    return refusal(answer, answer.body?.data?.code ?? errors.code, said.join(' '));
}

export function createPayment(options: PaymentOptions): PaymentGateway {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 15_000;

    // Zarinpal answers a refusal with a 4xx AND a populated `errors` object, so the body is
    // worth reading even when the status is not ok - see ./wire.ts, which also keeps what
    // went wrong when there was no body to read.
    function post(path: string, body: Record<string, unknown>): Promise<Answer<ZarinpalBody>> {
        return postJson<ZarinpalBody>(
            call,
            `${options.settings().baseUrl}/pg/v4/payment/${path}`,
            body,
            timeoutMs
        );
    }

    return {
        /**
         * Opens a payment. Zarinpal's `amount` is in the currency named by `currency`; this
         * sends Toman explicitly (IRT) rather than relying on an account default, because
         * the default is a setting someone can change without touching this code.
         */
        async request(input: PaymentRequest): Promise<RequestResult> {
            const answer = await post('request.json', {
                merchant_id: options.settings().merchantId,
                amount: input.tomanAmount,
                currency: 'IRT',
                description: input.description,
                callback_url: input.callbackUrl
            });

            if (answer.body?.data?.code !== 100) {
                return { ok: false, reason: `zarinpal: request failed (${why(answer)})` };
            }
            const { authority } = answer.body.data;
            if (typeof authority !== 'string' || authority === '') {
                // Said apart from a refusal: Zarinpal answered 100 here, and "failed (code
                // 100)" would send whoever reads the log looking for a problem that is not there.
                return { ok: false, reason: 'zarinpal: request succeeded without an authority' };
            }
            return {
                ok: true,
                authority,
                payUrl: `${options.settings().baseUrl}/pg/StartPay/${authority}`
            };
        },

        /**
         * Confirms a payment. `tomanAmount` MUST come from our stored order, never from the
         * request that triggered this - passing back an amount the caller supplied is how a
         * five-dollar payment becomes a twenty-five-dollar card.
         *
         * 100 = verified now. 101 = verified earlier; Zarinpal returns it on every repeat,
         * which is exactly what a browser refresh produces. Both mean "the money is real";
         * only the first may mint a code.
         */
        async verify(authority: string, tomanAmount: number): Promise<VerifyResult> {
            const answer = await post('verify.json', {
                merchant_id: options.settings().merchantId,
                amount: tomanAmount,
                authority
            });

            const code = answer.body?.data?.code;
            if (code !== 100 && code !== 101) {
                return { ok: false, reason: `zarinpal: verify failed (${why(answer)})` };
            }
            return {
                ok: true,
                refId: answer.body?.data?.ref_id ?? 0,
                alreadyVerified: code === 101
            };
        }
    };
}
