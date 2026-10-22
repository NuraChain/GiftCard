// The English shop's gateway, its delivery, and the switch that verifies through it.
//
// Plisio is tested against an INJECTED fetch, so every claim below is about what this code
// sends and what it does with an answer - not about Plisio. The answers are transcribed from
// Plisio's published reference; the first real invoice is still the first real invoice.
//
// What is worth proving is where Plisio differs from the Iranian gateways, because each is a
// way to lose money quietly: the price is dollars at face value, the amount check verify has
// to do itself, and the PENDING answer that must never be mistaken for a refusal.
import { describe, it, expect } from 'vitest';

import { createGatewaySwitch } from '../src/features/checkout/gateway.ts';
import { composeCodeMail, createMailer } from '../src/features/checkout/mailer.ts';
import { createPlisio } from '../src/features/checkout/plisio.ts';
import type { PaymentGateway } from '../src/features/checkout/zarinpal.ts';
import { normalizeEmail } from '../src/domain/email.ts';

const SETTINGS = { apiKey: 'secret-key-1234', baseUrl: 'https://plisio.test' };

const INVOICE = {
    usdAmount: 10,
    orderNumber: 123_456_789_012,
    orderName: 'Shop $10 gift card',
    email: 'buyer@example.com',
    callbackUrl: 'https://shop.test/api/pay/plisio?json=true',
    returnUrl: 'https://shop.test/en?pay=return#purchase',
    expireMinutes: 60
};

/** A fetch that answers one fixed thing and records every URL it was asked for. */
function recorder(answer: unknown) {
    const urls: URL[] = [];
    const fake = (url: string): Promise<Response> => {
        urls.push(new URL(url));
        if (answer instanceof Error) {
            return Promise.reject(answer);
        }
        if (answer instanceof Response) {
            return Promise.resolve(answer);
        }
        return Promise.resolve(
            new Response(JSON.stringify(answer), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    return { urls, fetch: fake };
}

function plisio(answer: unknown) {
    const wire = recorder(answer);
    return { ...wire, gateway: createPlisio({ settings: () => SETTINGS, fetch: wire.fetch }) };
}

/** A transaction-details answer in the given state, for the given sum. */
function operation(status: string, sourceAmount: number | string = 10, currency = 'USD') {
    return {
        status: 'success',
        data: {
            status,
            source_currency: currency,
            params: { source_amount: sourceAmount, order_number: '123456789012' }
        }
    };
}

describe('opening a Plisio invoice', () => {
    it('prices it in DOLLARS at face value and sends nothing that reads a code back', async () => {
        const { gateway, urls } = plisio({
            status: 'success',
            data: { txn_id: '5f1a2b3c4d', invoice_url: 'https://plisio.test/invoice/5f1a2b3c4d' }
        });

        const opened = await gateway.request(INVOICE);

        expect(opened).toEqual({
            ok: true,
            authority: '5f1a2b3c4d',
            payUrl: 'https://plisio.test/invoice/5f1a2b3c4d'
        });
        const [url] = urls;
        expect(url.pathname).toBe('/api/v1/invoices/new');
        expect(url.searchParams.get('source_currency')).toBe('USD');
        expect(url.searchParams.get('source_amount')).toBe('10');
        expect(url.searchParams.get('order_number')).toBe('123456789012');
        expect(url.searchParams.get('email')).toBe('buyer@example.com');
        expect(url.searchParams.get('callback_url')).toBe(INVOICE.callbackUrl);
        expect(url.searchParams.get('success_invoice_url')).toBe(INVOICE.returnUrl);
        expect(url.searchParams.get('expire_min')).toBe('60');
        expect(url.searchParams.get('api_key')).toBe(SETTINGS.apiKey);
    });

    it('opens nothing without a key', async () => {
        const wire = recorder({});
        const gateway = createPlisio({
            settings: () => ({ ...SETTINGS, apiKey: '' }),
            fetch: wire.fetch
        });
        const { urls } = wire;
        expect(await gateway.request(INVOICE)).toEqual({
            ok: false,
            reason: 'plisio: no API key is set'
        });
        expect(urls).toHaveLength(0);
    });

    it("passes Plisio's refusal on, and never the URL the key travelled in", async () => {
        const { gateway } = plisio({
            status: 'error',
            data: { name: 'Bad Request', message: 'Invalid api key', code: 103 }
        });

        const opened = await gateway.request(INVOICE);

        expect(opened.ok).toBe(false);
        const reason = opened.ok ? '' : opened.reason;
        expect(reason).toContain('code 103: Invalid api key');
        expect(reason).not.toContain(SETTINGS.apiKey);
    });

    it('refuses an invoice whose txn id could not go into a path', async () => {
        const { gateway } = plisio({
            status: 'success',
            data: { txn_id: '../admin', invoice_url: 'https://plisio.test/invoice/x' }
        });
        expect((await gateway.request(INVOICE)).ok).toBe(false);
    });

    it('answers a host that is not a URL instead of throwing', async () => {
        const gateway = createPlisio({
            settings: () => ({ apiKey: 'k', baseUrl: 'not a url' }),
            fetch: () => Promise.reject(new Error('never called'))
        });
        expect((await gateway.request(INVOICE)).ok).toBe(false);
    });
});

describe('reading a Plisio invoice back', () => {
    it('calls a completed invoice for OUR sum paid, with the order number as the reference', async () => {
        const { gateway, urls } = plisio(operation('completed'));

        expect(await gateway.verify('5f1a2b3c4d', 10)).toEqual({
            ok: true,
            refId: 123_456_789_012,
            alreadyVerified: false
        });
        expect(urls[0].pathname).toBe('/api/v1/operations/5f1a2b3c4d');
        expect(urls[0].searchParams.get('api_key')).toBe(SETTINGS.apiKey);
    });

    it('takes an overpaid invoice as paid', async () => {
        const { gateway } = plisio(operation('mismatch', '10.00'));
        expect((await gateway.verify('5f1a2b3c4d', 10)).ok).toBe(true);
    });

    it('refuses a completed invoice for a DIFFERENT sum - rule 2, kept here', async () => {
        // A $3 invoice's id presented against a $20 order must not mint a $20 code.
        const { gateway } = plisio(operation('completed', 3));
        const verified = await gateway.verify('5f1a2b3c4d', 20);

        expect(verified.ok).toBe(false);
        expect(verified.ok ? undefined : verified.pending).toBeUndefined();
    });

    it('refuses a completed invoice in another currency', async () => {
        const { gateway } = plisio(operation('completed', 10, 'EUR'));
        expect((await gateway.verify('5f1a2b3c4d', 10)).ok).toBe(false);
    });

    it.each(['new', 'pending', 'pending internal', 'cancelled duplicate'])(
        'leaves a %s invoice PENDING rather than refused',
        async (status) => {
            const { gateway } = plisio(operation(status));
            const verified = await gateway.verify('5f1a2b3c4d', 10);
            expect(verified).toMatchObject({ ok: false, pending: true });
        }
    );

    it.each(['expired', 'cancelled', 'error'])('refuses an %s invoice', async (status) => {
        const { gateway } = plisio(operation(status));
        const verified = await gateway.verify('5f1a2b3c4d', 10);
        expect(verified.ok).toBe(false);
        expect(verified.ok ? undefined : verified.pending).toBeUndefined();
    });

    it('calls an unreachable Plisio PENDING - silence says nothing about the money', async () => {
        const { gateway } = plisio(new TypeError('fetch failed'));
        expect(await gateway.verify('5f1a2b3c4d', 10)).toMatchObject({
            ok: false,
            pending: true
        });
    });

    it('calls an unreadable answer PENDING too', async () => {
        const { gateway } = plisio(new Response('<html>blocked</html>', { status: 403 }));
        expect(await gateway.verify('5f1a2b3c4d', 10)).toMatchObject({
            ok: false,
            pending: true
        });
    });
});

describe('the switch, with Plisio behind it', () => {
    it('verifies a plisio: handle through Plisio, with the dollar amount it was given', async () => {
        const asked: Array<{ who: string; authority: string; amount: number }> = [];
        const named = (who: string): PaymentGateway => ({
            request: () => Promise.resolve({ ok: false, reason: 'unused' }),
            verify: (authority, amount) => {
                asked.push({ who, authority, amount });
                return Promise.resolve({ ok: true, refId: 1, alreadyVerified: false });
            }
        });
        const payment = createGatewaySwitch({
            active: () => 'zarinpal',
            zarinpal: named('zarinpal'),
            zibal: named('zibal'),
            plisio: named('plisio')
        });

        await payment.verify('plisio:5f1a2b3c4d', 10);

        expect(asked).toEqual([{ who: 'plisio', authority: '5f1a2b3c4d', amount: 10 }]);
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
