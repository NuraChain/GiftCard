// Zarinpal, the only place money is spoken about.
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

    /** Passed to the gateway as metadata so a refund can be matched to a buyer. */
    email: string;
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
    errors?: unknown;
}

export function createPayment(options: PaymentOptions): PaymentGateway {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 15_000;

    async function post(path: string, body: Record<string, unknown>): Promise<ZarinpalBody | null> {
        try {
            const response = await call(`${options.settings().baseUrl}/pg/v4/payment/${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            });
            // Zarinpal answers 4xx with a populated errors array, so the body is worth
            // reading even when the status is not ok.
            return (await response.json()) as ZarinpalBody;
        } catch {
            // Network failure, timeout, or unparseable body: indistinguishable from here,
            // and all mean the same thing to the caller - no answer.
            return null;
        }
    }

    return {
        /**
         * Opens a payment. Zarinpal's `amount` is in the currency named by `currency`; this
         * sends Toman explicitly (IRT) rather than relying on an account default, because
         * the default is a setting someone can change without touching this code.
         */
        async request(input: PaymentRequest): Promise<RequestResult> {
            const body = await post('request.json', {
                merchant_id: options.settings().merchantId,
                amount: input.tomanAmount,
                currency: 'IRT',
                description: input.description,
                callback_url: input.callbackUrl,
                metadata: { email: input.email }
            });

            const code = body?.data?.code;
            const authority = body?.data?.authority;
            if (code !== 100 || typeof authority !== 'string' || authority === '') {
                return { ok: false, reason: `request failed (code ${code ?? 'none'})` };
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
            const body = await post('verify.json', {
                merchant_id: options.settings().merchantId,
                amount: tomanAmount,
                authority
            });

            const code = body?.data?.code;
            if (code !== 100 && code !== 101) {
                return { ok: false, reason: `verify failed (code ${code ?? 'none'})` };
            }
            return { ok: true, refId: body?.data?.ref_id ?? 0, alreadyVerified: code === 101 };
        }
    };
}
