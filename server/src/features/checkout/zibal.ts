// Zibal, the second gateway this shop can be paid through.
//
// Built the way ./zarinpal.ts is and for the same reasons - `fetch` injected, the merchant read
// per call, a timeout on everything outbound - so read that file first. What is written down
// here is only where Zibal DIFFERS, because every difference is about money:
//
//   1. AMOUNTS ARE RIAL. The shop thinks in Toman and Zarinpal is told so explicitly. Zibal has
//      no such switch, so every sum is multiplied by ten on the way out and compared against
//      ten times ours on the way back. Forgetting it in one direction sells a card for a tenth
//      of its price; forgetting it in the other refuses every honest payment.
//   2. VERIFY TAKES NO AMOUNT. Zarinpal is handed our stored amount and refuses a mismatch
//      itself. Zibal is handed only the track id and ANSWERS with what it charged - so the rule
//      in checkout.ts, that the amount comes from our own row, is kept by checking that answer
//      here. An answer for a different sum is not a payment of this order.
//   3. A REPEAT VERIFY IS 201, AND IT SAYS NOTHING ELSE. Zarinpal's 101 repeats the reference;
//      Zibal's 201 is a bare `{ result: 201 }` with no amount and no status in it, so the
//      payment is confirmed through `inquiry` before it is believed.
//   4. THE BUYER'S ADDRESS IS NOT SENT. Zibal has no metadata field to carry it, and its
//      `orderId` is deliberately left empty: the only id this shop has for an order is the
//      receipt token, which is the bearer handle the code is read back with. A value like that
//      does not belong in a third party's reports.
//
// Wire shapes are transcribed from Zibal's published reference (help.zibal.ir/ipg) and from
// their own Node SDK, and were checked once against their test merchant. The SDK is followed
// rather than depended on: it throws on 201, and 201 is the one answer that has to be handled
// rather than refused.
import type {
    Fetch,
    PaymentGateway,
    PaymentRequest,
    RequestResult,
    VerifyResult
} from './zarinpal.ts';

export interface ZibalOptions {
    /** Read PER CALL, for the reason given on the same field in ./zarinpal.ts. */
    settings: () => { merchant: string; baseUrl: string };

    fetch?: Fetch;

    /** Outbound timeout. A gateway that hangs must not hang the buyer's request. */
    timeoutMs?: number;
}

/** Every field this file reads, across `request`, `verify` and `inquiry`. All optional: it is somebody else's JSON. */
interface ZibalBody {
    result?: number;
    trackId?: number | string;

    /** 1 is "paid and verified" - the only status that means the money is ours. */
    status?: number;

    /** In Rial. */
    amount?: number;

    /**
     * The bank's reference. A number in the docs, a string in the SDK's types and null on a
     * test payment, so all three are read.
     */
    refNumber?: number | string | null;
}

const RIAL_PER_TOMAN = 10;

/**
 * @internal A track id that survived the trip through JSON, or null.
 *
 * Zibal issues these as 64-bit integers and JSON has no such thing: one past 2^53 would arrive
 * already rounded to a DIFFERENT payment's id. Nothing here can repair that, so it is refused -
 * an order that cannot be found on the way back is worse than one that never opened.
 */
function trackIdFrom(raw: unknown): number | null {
    const parsed = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * @internal The reference a buyer quotes in support: the bank's when there is one, and the
 * track id when there is not.
 *
 * `refNumber` is null on every test payment and is somebody else's field on a real one. The
 * track id is the number Zibal's own panel and support search by, so falling back to it means
 * a paid order is never left carrying a reference of zero.
 */
function refIdFrom(raw: unknown, trackId: number): number {
    const parsed = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : trackId;
}

/**
 * @internal The two facts that make an answer a payment OF THIS ORDER: the money settled, and
 * it was our sum. This is rule 2 at the top of the file, in one place so `verify` and `inquiry`
 * cannot come to disagree about it.
 */
function paidInFull(body: ZibalBody | null, tomanAmount: number): boolean {
    return body?.status === 1 && body.amount === tomanAmount * RIAL_PER_TOMAN;
}

export function createZibal(options: ZibalOptions): PaymentGateway {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 15_000;

    async function post(path: string, body: Record<string, unknown>): Promise<ZibalBody | null> {
        try {
            const response = await call(`${options.settings().baseUrl}/v1/${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            });
            // Zibal reports a refusal in `result` rather than in the status line, so the body
            // is read whatever the status was.
            return (await response.json()) as ZibalBody | null;
        } catch {
            // Network failure, timeout, or unparseable body: indistinguishable from here,
            // and all mean the same thing to the caller - no answer.
            return null;
        }
    }

    return {
        /**
         * Opens a payment. The track id that comes back is this gateway's whole handle on it:
         * the buyer is sent to `/start/<trackId>`, and returns carrying the same number.
         */
        async request(input: PaymentRequest): Promise<RequestResult> {
            const body = await post('request', {
                merchant: options.settings().merchant,
                amount: input.tomanAmount * RIAL_PER_TOMAN,
                callbackUrl: input.callbackUrl,
                description: input.description
            });

            const trackId = trackIdFrom(body?.trackId);
            if (body?.result !== 100 || trackId === null) {
                return { ok: false, reason: `request failed (code ${body?.result ?? 'none'})` };
            }
            return {
                ok: true,
                authority: String(trackId),
                payUrl: `${options.settings().baseUrl}/start/${trackId}`
            };
        },

        /**
         * Confirms a payment. `tomanAmount` MUST come from our stored order - see rule 2 above
         * for why it is compared here rather than sent.
         *
         * 100 = verified now. 201 = verified earlier, which is what a browser refresh produces
         * and ALSO what is left behind when the first verify succeeded and its answer never
         * reached us. Both mean "the money is real"; only the first may mint a code. Refusing
         * 201 would strand exactly the buyer whose payment was caught in a timeout.
         */
        async verify(authority: string, tomanAmount: number): Promise<VerifyResult> {
            const trackId = trackIdFrom(authority);
            if (trackId === null) {
                return { ok: false, reason: 'verify failed (unreadable track id)' };
            }

            const merchant = options.settings().merchant;
            const body = await post('verify', { merchant, trackId });
            const result = body?.result;

            if (result === 100) {
                if (!paidInFull(body, tomanAmount)) {
                    return { ok: false, reason: 'verify answered for a different payment' };
                }
                return {
                    ok: true,
                    refId: refIdFrom(body?.refNumber, trackId),
                    alreadyVerified: false
                };
            }

            if (result === 201) {
                const report = await post('inquiry', { merchant, trackId });
                if (report?.result !== 100 || !paidInFull(report, tomanAmount)) {
                    return {
                        ok: false,
                        reason: `already verified, but inquiry did not confirm it (code ${report?.result ?? 'none'})`
                    };
                }
                return {
                    ok: true,
                    refId: refIdFrom(report.refNumber, trackId),
                    alreadyVerified: true
                };
            }

            return { ok: false, reason: `verify failed (code ${result ?? 'none'})` };
        }
    };
}
