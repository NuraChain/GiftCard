// The English shop's gateway, its delivery, and the switch that verifies through it.
//
// NOWPayments is tested against an INJECTED fetch, so every claim below is about what this
// code sends and what it does with an answer - not about NOWPayments. The answers are
// transcribed from NOWPayments' published reference; the first real invoice is still the
// first real invoice.
//
// What is worth proving is where NOWPayments differs from the Iranian gateways, because each
// is a way to lose money quietly: the price is dollars at face value, the payments under an
// invoice that have to be learned before they can be read, the amount check verify has to do
// itself, and the PENDING answer that must never be mistaken for a refusal.
import { describe, it, expect } from 'vitest';

import { createGatewaySwitch } from '../src/features/checkout/gateway.ts';
import { composeCodeMail, createMailer } from '../src/features/checkout/mailer.ts';
import { createNowPayments } from '../src/features/checkout/nowpayments.ts';
import type { PaymentGateway } from '../src/features/checkout/zarinpal.ts';
import { normalizeEmail } from '../src/domain/email.ts';

const SETTINGS = { apiKey: 'secret-key-1234', baseUrl: 'https://nowpayments.test' };

const INVOICE = {
    usdAmount: 10,
    orderNumber: 123_456_789_012,
    orderName: 'Shop $10 gift card',
    callbackUrl: 'https://shop.test/api/pay/nowpayments',
    returnUrl: 'https://shop.test/en?pay=return#purchase'
};

interface Asked {
    url: URL;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown> | null;
}

/**
 * A fetch that answers by path and records every call. An answer is a status-and-body pair,
 * an Error (the network failing) or a Response (anything that is not JSON).
 */
function recorder(answer: (url: URL) => unknown) {
    const asked: Asked[] = [];
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
        const parsed = new URL(url);
        asked.push({
            url: parsed,
            method: init?.method ?? 'GET',
            headers: (init?.headers ?? {}) as Record<string, string>,
            body:
                typeof init?.body === 'string'
                    ? (JSON.parse(init.body) as Record<string, unknown>)
                    : null
        });
        const given = answer(parsed);
        if (given instanceof Error) {
            return Promise.reject(given);
        }
        if (given instanceof Response) {
            return Promise.resolve(given);
        }
        const { status, body } = given as { status: number; body: unknown };
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    return { asked, fetch: fake };
}

function nowpayments(answer: (url: URL) => unknown, known: string[] = []) {
    const wire = recorder(answer);
    return {
        ...wire,
        gateway: createNowPayments({
            settings: () => SETTINGS,
            paymentsFor: async () => known,
            fetch: wire.fetch
        })
    };
}

/** A payment-status answer in the given state, for the given sum, under the given invoice. */
function payment(
    status: string,
    {
        amount = 10,
        currency = 'usd',
        invoice = 4_522_625_843
    }: { amount?: number | string; currency?: string; invoice?: number } = {}
) {
    return {
        status: 200,
        body: {
            payment_id: 5_745_459_419,
            invoice_id: invoice,
            payment_status: status,
            price_amount: amount,
            price_currency: currency,
            pay_currency: 'usdttrc20'
        }
    };
}

const CREATED = {
    status: 200,
    body: {
        id: '4522625843',
        order_id: '123456789012',
        invoice_url: 'https://nowpayments.io/payment/?iid=4522625843'
    }
};

describe('opening a NOWPayments invoice', () => {
    it('prices it in DOLLARS at face value and sends nothing that reads a code back', async () => {
        const { gateway, asked } = nowpayments(() => CREATED);

        const opened = await gateway.request(INVOICE);

        expect(opened).toEqual({
            ok: true,
            authority: '4522625843',
            payUrl: 'https://nowpayments.io/payment/?iid=4522625843'
        });
        const [call] = asked;
        expect(call.method).toBe('POST');
        expect(call.url.href).toBe('https://nowpayments.test/v1/invoice');
        expect(call.headers['x-api-key']).toBe(SETTINGS.apiKey);
        expect(call.body).toEqual({
            price_amount: 10,
            price_currency: 'usd',
            order_id: '123456789012',
            order_description: 'Shop $10 gift card',
            ipn_callback_url: INVOICE.callbackUrl,
            success_url: INVOICE.returnUrl,
            cancel_url: INVOICE.returnUrl,
            partially_paid_url: INVOICE.returnUrl
        });
        // The key is a header, never part of the address.
        expect(call.url.href).not.toContain(SETTINGS.apiKey);
    });

    it('takes an invoice id that comes back as a number', async () => {
        const { gateway } = nowpayments(() => ({
            status: 201,
            body: { id: 4_522_625_843, invoice_url: 'https://nowpayments.io/payment/?iid=1' }
        }));
        expect(await gateway.request(INVOICE)).toMatchObject({ ok: true, authority: '4522625843' });
    });

    it('opens nothing without a key', async () => {
        const wire = recorder(() => CREATED);
        const gateway = createNowPayments({
            settings: () => ({ ...SETTINGS, apiKey: '' }),
            paymentsFor: async () => [],
            fetch: wire.fetch
        });
        expect(await gateway.request(INVOICE)).toEqual({
            ok: false,
            reason: 'nowpayments: no API key is set'
        });
        expect(wire.asked).toHaveLength(0);
    });

    it("passes NOWPayments' refusal on, and never the key", async () => {
        const { gateway } = nowpayments(() => ({
            status: 403,
            body: {
                status: false,
                statusCode: 403,
                code: 'INVALID_API_KEY',
                message: 'Invalid api key'
            }
        }));

        const opened = await gateway.request(INVOICE);

        expect(opened.ok).toBe(false);
        const reason = opened.ok ? '' : opened.reason;
        expect(reason).toContain('code INVALID_API_KEY: Invalid api key');
        expect(reason).toContain('http 403');
        expect(reason).not.toContain(SETTINGS.apiKey);
    });

    it('refuses an invoice whose id could not go into a path', async () => {
        const { gateway } = nowpayments(() => ({
            status: 200,
            body: { id: '../admin', invoice_url: 'https://nowpayments.test/x' }
        }));
        expect((await gateway.request(INVOICE)).ok).toBe(false);
    });

    it('answers a host that is not a URL instead of throwing', async () => {
        const gateway = createNowPayments({
            settings: () => ({ apiKey: 'k', baseUrl: 'not a url' }),
            paymentsFor: async () => [],
            fetch: () => Promise.reject(new Error('never called'))
        });
        expect((await gateway.request(INVOICE)).ok).toBe(false);
    });
});

describe('learning a payment', () => {
    it('keeps a payment NOWPayments puts under the invoice, whatever type the id comes in', async () => {
        const { gateway, asked } = nowpayments(() => payment('waiting'));

        expect(await gateway.learn('4522625843', '5745459419')).toBe(true);
        expect(asked[0].url.href).toBe('https://nowpayments.test/v1/payment/5745459419');
        expect(asked[0].headers['x-api-key']).toBe(SETTINGS.apiKey);
    });

    it("refuses a payment under somebody else's invoice", async () => {
        const { gateway } = nowpayments(() => payment('finished', { invoice: 999 }));
        expect(await gateway.learn('4522625843', '5745459419')).toBe(false);
    });

    it('refuses an id that is not digits without asking anyone', async () => {
        const { gateway, asked } = nowpayments(() => payment('finished'));
        expect(await gateway.learn('4522625843', '../payout')).toBe(false);
        expect(asked).toHaveLength(0);
    });

    it('refuses when NOWPayments cannot be asked', async () => {
        const { gateway } = nowpayments(() => new TypeError('fetch failed'));
        expect(await gateway.learn('4522625843', '5745459419')).toBe(false);
    });
});

describe('naming the invoice a payment is under', () => {
    it('takes the invoice NOWPayments names for the payment, not one the request carried', async () => {
        const { gateway, asked } = nowpayments(() => payment('waiting'));

        expect(await gateway.invoiceOf('5745459419')).toBe('4522625843');
        expect(asked[0].url.href).toBe('https://nowpayments.test/v1/payment/5745459419');
        expect(asked[0].headers['x-api-key']).toBe(SETTINGS.apiKey);
    });

    it('names nothing when NOWPayments cannot read the payment', async () => {
        const { gateway } = nowpayments(() => ({ status: 404, body: { message: 'not found' } }));
        expect(await gateway.invoiceOf('5745459419')).toBeNull();
    });

    it('names nothing when NOWPayments is unreachable', async () => {
        const { gateway } = nowpayments(() => new TypeError('fetch failed'));
        expect(await gateway.invoiceOf('5745459419')).toBeNull();
    });

    it('asks nobody about an id that is not digits', async () => {
        const { gateway, asked } = nowpayments(() => payment('finished'));
        expect(await gateway.invoiceOf('../payout')).toBeNull();
        expect(asked).toHaveLength(0);
    });
});

describe('reading a NOWPayments invoice back', () => {
    const KNOWN = ['5745459419'];

    it('calls a finished payment for OUR sum paid, with the payment id as the reference', async () => {
        const { gateway } = nowpayments(() => payment('finished'), KNOWN);
        expect(await gateway.verify('4522625843', 10)).toEqual({
            ok: true,
            refId: 5_745_459_419,
            alreadyVerified: false
        });
    });

    it('takes the sum as a string too', async () => {
        const { gateway } = nowpayments(() => payment('finished', { amount: '10' }), KNOWN);
        expect((await gateway.verify('4522625843', 10)).ok).toBe(true);
    });

    it('refuses a finished payment for a DIFFERENT sum - rule 2, kept here', async () => {
        const { gateway } = nowpayments(() => payment('finished', { amount: 3 }), KNOWN);
        const verified = await gateway.verify('4522625843', 10);
        expect(verified.ok).toBe(false);
        expect(verified).not.toHaveProperty('pending');
    });

    it('refuses a finished payment in another currency', async () => {
        const { gateway } = nowpayments(() => payment('finished', { currency: 'eur' }), KNOWN);
        expect((await gateway.verify('4522625843', 10)).ok).toBe(false);
    });

    it('calls an invoice no payment is known for PENDING, without a call', async () => {
        const { gateway, asked } = nowpayments(() => payment('finished'));
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
        expect(asked).toHaveLength(0);
    });

    it.each(['waiting', 'confirming', 'confirmed', 'sending'])(
        'calls a %s payment PENDING - seen, not yet money',
        async (state) => {
            const { gateway } = nowpayments(() => payment(state), KNOWN);
            expect(await gateway.verify('4522625843', 10)).toMatchObject({
                ok: false,
                pending: true
            });
        }
    );

    it('never delivers a PARTIALLY paid one, and never cancels it either', async () => {
        const { gateway } = nowpayments(() => payment('partially_paid'), KNOWN);
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
    });

    it.each(['failed', 'expired', 'refunded'])('calls a %s payment a failure', async (state) => {
        const { gateway } = nowpayments(() => payment(state), KNOWN);
        const verified = await gateway.verify('4522625843', 10);
        expect(verified.ok).toBe(false);
        expect(verified).not.toHaveProperty('pending');
    });

    it('pays an invoice whose FIRST payment expired and whose second finished', async () => {
        const { gateway } = nowpayments(
            (url) => payment(url.pathname.endsWith('/1') ? 'expired' : 'finished'),
            ['1', '2']
        );
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: true, refId: 2 });
    });

    it('keeps an invoice alive while any payment under it still is', async () => {
        const { gateway } = nowpayments(
            (url) => payment(url.pathname.endsWith('/1') ? 'expired' : 'confirming'),
            ['1', '2']
        );
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
    });

    it('settles nothing on a payment that turned out to be under another invoice', async () => {
        const { gateway } = nowpayments(() => payment('finished', { invoice: 1 }), KNOWN);
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
    });

    it('calls an unreachable NOWPayments PENDING - silence says nothing about the money', async () => {
        const { gateway } = nowpayments(() => new TypeError('fetch failed'), KNOWN);
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
    });

    it('calls an unreadable answer PENDING too', async () => {
        const { gateway } = nowpayments(
            () => new Response('<html>blocked</html>', { status: 403 }),
            KNOWN
        );
        expect(await gateway.verify('4522625843', 10)).toMatchObject({ ok: false, pending: true });
    });
});

describe('the switch, with NOWPayments behind it', () => {
    it('verifies a nowpayments: handle through NOWPayments, with the dollar amount it was given', async () => {
        const asked: Array<{ who: string; authority: string; amount: number }> = [];
        const named = (who: string): PaymentGateway => ({
            request: () => Promise.resolve({ ok: false, reason: 'unused' }),
            verify: (authority, amount) => {
                asked.push({ who, authority, amount });
                return Promise.resolve({ ok: true, refId: 1, alreadyVerified: false });
            }
        });
        const gateway = createGatewaySwitch({
            active: () => 'zarinpal',
            zarinpal: named('zarinpal'),
            zibal: named('zibal'),
            nowpayments: named('nowpayments')
        });

        await gateway.verify('nowpayments:4522625843', 10);

        expect(asked).toEqual([{ who: 'nowpayments', authority: '4522625843', amount: 10 }]);
    });
});

describe('the code by email', () => {
    const LIVE = {
        apiKey: 're_key',
        from: 'Shop <codes@shop.test>',
        baseUrl: 'https://resend.test',
        appName: 'Shop'
    };

    it('writes an English, left-to-right message with the code on its own line', () => {
        const mail = composeCodeMail(LIVE, 'buyer@example.com', 'abc-123', 10);

        expect(mail.subject).toBe('Your $10 gift card code - Shop');
        expect(mail.text.split('\n')).toContain('abc-123');
        expect(mail.html).toContain('<html lang="en" dir="ltr">');
    });

    it('posts it to Resend with the key as a bearer token', async () => {
        const sent: Array<{ url: string; init?: RequestInit }> = [];
        const mailer = createMailer({
            settings: () => LIVE,
            fetch: (url, init) => {
                sent.push({ url, init });
                return Promise.resolve(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
            }
        });

        expect(await mailer.sendCode('buyer@example.com', 'abc-123', 10)).toEqual({ ok: true });
        expect(sent[0].url).toBe('https://resend.test/emails');
        expect(new Headers(sent[0].init?.headers).get('authorization')).toBe('Bearer re_key');
        const body = JSON.parse(String(sent[0].init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ from: LIVE.from, to: 'buyer@example.com' });
    });

    it("repeats Resend's own reason for a refusal", async () => {
        const mailer = createMailer({
            settings: () => LIVE,
            fetch: () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({ message: 'The shop.test domain is not verified' }),
                        {
                            status: 403
                        }
                    )
                )
        });
        const sent = await mailer.sendCode('buyer@example.com', 'abc-123', 10);
        expect(sent).toEqual({
            ok: false,
            reason: 'Resend refused the message (403): The shop.test domain is not verified'
        });
    });

    it('names what is missing rather than sending', async () => {
        const mailer = createMailer({
            settings: () => ({ ...LIVE, apiKey: '', from: '' }),
            fetch: () => Promise.reject(new Error('never called'))
        });
        expect(await mailer.sendCode('buyer@example.com', 'abc-123', 10)).toEqual({
            ok: false,
            reason: 'Resend API key and From address not set'
        });
    });
});

describe('an email address', () => {
    it('is canonicalised, invisible marks and Persian digits included', () => {
        expect(normalizeEmail(' Ali‌۱۲@Gmail.COM ')).toBe('ali12@gmail.com');
    });

    it.each(['ali', 'ali@gmail', 'a b@gmail.com', 'ali@@gmail.com'])('refuses %s', (raw) => {
        expect(normalizeEmail(raw)).toBeNull();
    });
});
