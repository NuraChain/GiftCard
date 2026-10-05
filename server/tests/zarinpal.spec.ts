// Zarinpal's client, against an INJECTED fetch.
//
// What is proven here is narrow on purpose: what a refusal is WORDED as. That wording is the
// only thing the operator has when checkout answers "gateway unavailable", and for a long time
// it said `code none` for every refusal Zarinpal made - the code was being read from `data`,
// and Zarinpal puts a refusal's code in `errors`.
//
// The -10 body below is the live API's own answer, verbatim. The others follow the same shape
// with the codes and field lists from Zarinpal's reference.
import { describe, it, expect } from 'vitest';

import { createPayment } from '../src/features/checkout/zarinpal.ts';

const SETTINGS = {
    merchantId: '11111111-2222-3333-4444-555555555555',
    baseUrl: 'https://zarinpal.test'
};

const ORDER = {
    tomanAmount: 6000,
    description: 'خرید گیفت کارت',
    callbackUrl: 'https://shop.test/api/pay/callback',
    email: 'buyer@example.com'
};

/** A client whose one answer is `answer`: an `Error` is thrown, anything else is sent back. */
function zarinpal(answer: Response | Error) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    };
    return { calls, gateway: createPayment({ settings: () => SETTINGS, fetch: fake }) };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

describe('opening a Zarinpal payment', () => {
    it('opens one, in Toman, and hands back the authority', async () => {
        const { gateway, calls } = zarinpal(
            json({ data: { code: 100, message: 'Success', authority: 'A0001' }, errors: [] })
        );

        expect(await gateway.request(ORDER)).toEqual({
            ok: true,
            authority: 'A0001',
            payUrl: 'https://zarinpal.test/pg/StartPay/A0001'
        });
        expect(calls[0].url).toBe('https://zarinpal.test/pg/v4/payment/request.json');
        expect(calls[0].body).toMatchObject({ amount: 6000, currency: 'IRT' });
    });

    it('reads a refusal out of `errors`, where Zarinpal actually puts it', async () => {
        // THE TEST THIS FILE EXISTS FOR. This is the live API's answer to a merchant it does
        // not know, verbatim: `data` is empty and everything worth knowing is in `errors`.
        const { gateway } = zarinpal(
            json(
                {
                    data: {},
                    errors: { message: 'Invalid merchant_id.', code: -10, validations: [] }
                },
                422
            )
        );

        const refused = await gateway.request(ORDER);
        expect(refused).toEqual({
            ok: false,
            reason: 'zarinpal: request failed (code -10: Invalid merchant_id.; http 422)'
        });
        // What was SENT is never repeated: the request is where the merchant id is.
        expect(JSON.stringify(refused)).not.toContain(SETTINGS.merchantId);
    });

    it('names the field a validation refusal is about', async () => {
        // A -9 on its own says "something you sent is wrong". When Zarinpal fills in the list
        // beside it, the list says what - so it is repeated rather than dropped.
        const { gateway } = zarinpal(
            json(
                {
                    data: [],
                    errors: {
                        message: 'The input params invalid, validation error.',
                        code: -9,
                        validations: [{ callback_url: 'The callback url format is invalid.' }]
                    }
                },
                422
            )
        );

        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason:
                'zarinpal: request failed (code -9: The input params invalid, validation error. ' +
                '[{"callback_url":"The callback url format is invalid."}]; http 422)'
        });
    });

    it('does not call a success without an authority a refusal', async () => {
        const { gateway } = zarinpal(json({ data: { code: 100, message: 'Success' }, errors: [] }));
        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason: 'zarinpal: request succeeded without an authority'
        });
    });

    it('shows a block page for what it is', async () => {
        const page = new Response('<html>\n  <h1>403 Forbidden</h1>\n</html>', { status: 403 });
        const { gateway } = zarinpal(page);
        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason: 'zarinpal: request failed (http 403, not JSON: <html> <h1>403 Forbidden</h1> </html>)'
        });
    });

    it('says how the network failed', async () => {
        const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
            code: 'ECONNREFUSED'
        });
        const { gateway } = zarinpal(new TypeError('fetch failed', { cause }));
        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason: 'zarinpal: request failed (no answer: TypeError: fetch failed - ECONNREFUSED: connect ECONNREFUSED 10.0.0.1:443)'
        });
    });
});

describe('verifying a Zarinpal payment', () => {
    it('takes 100 as paid now and 101 as paid earlier', async () => {
        const first = zarinpal(json({ data: { code: 100, ref_id: 201 }, errors: [] }));
        expect(await first.gateway.verify('A0001', 6000)).toEqual({
            ok: true,
            refId: 201,
            alreadyVerified: false
        });
        // The amount that goes out is OURS - the one argument, not anything read off a request.
        expect(first.calls[0].body).toMatchObject({ amount: 6000, authority: 'A0001' });

        const again = zarinpal(json({ data: { code: 101, ref_id: 201 }, errors: [] }));
        expect(await again.gateway.verify('A0001', 6000)).toMatchObject({
            ok: true,
            alreadyVerified: true
        });
    });

    it('repeats why a payment was not verified', async () => {
        const { gateway } = zarinpal(
            json(
                {
                    data: [],
                    errors: { message: 'Session is not valid.', code: -51, validations: [] }
                },
                400
            )
        );
        expect(await gateway.verify('A0001', 6000)).toEqual({
            ok: false,
            reason: 'zarinpal: verify failed (code -51: Session is not valid.; http 400)'
        });
    });

    it('NEVER takes a code out of `errors` for a payment', async () => {
        // `errors.code` is read to word a refusal. If it were ever read to decide one, a body
        // shaped like this would mint a card for money nobody sent.
        const { gateway } = zarinpal(json({ data: [], errors: { code: 100, message: 'Success' } }));
        expect((await gateway.verify('A0001', 6000)).ok).toBe(false);
    });
});
