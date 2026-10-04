// The second gateway, and the switch that sits in front of both.
//
// The client is tested against an INJECTED fetch, so every claim below is about what this code
// sends and what it does with an answer - not about Zibal. The answers are transcribed from
// their published reference; the first real payment is still the first real payment.
//
// What is worth proving here is the handful of places Zibal differs from Zarinpal, because
// each one is a way to lose money quietly: the unit, the amount check that verify does not do
// for us, and the "already verified" answer that must not be mistaken for a failure.
import { describe, it, expect } from 'vitest';

import { createGatewaySwitch, readReturn } from '../src/features/checkout/gateway.ts';
import type {
    PaymentGateway,
    RequestResult,
    VerifyResult
} from '../src/features/checkout/zarinpal.ts';
import { createZibal } from '../src/features/checkout/zibal.ts';

const SETTINGS = { merchant: 'merchant-abc', baseUrl: 'https://zibal.test' };

/** 1,309,000 Toman is what a $10 card costs in the app suite; in Rial it is ten times that. */
const TOMAN = 1_309_000;
const RIAL = 13_090_000;

const ORDER = {
    tomanAmount: TOMAN,
    description: 'خرید گیفت کارت',
    callbackUrl: 'https://shop.test/api/pay/callback',
    email: 'buyer@example.com'
};

/**
 * A fetch that answers per endpoint and records what it was sent.
 *
 * Keyed by the last path segment - `request`, `verify`, `inquiry` - because the interesting
 * cases are the ones where two of them are called in a row and must be told apart.
 */
function recorder(answers: Record<string, unknown>) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        const answer = answers[url.slice(url.lastIndexOf('/') + 1)];
        if (answer === undefined) {
            return Promise.reject(new Error('network down'));
        }
        return Promise.resolve(
            new Response(JSON.stringify(answer), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );
    };
    return { calls, fetch: fake };
}

function zibal(answers: Record<string, unknown>) {
    const wire = recorder(answers);
    return { ...wire, gateway: createZibal({ settings: () => SETTINGS, fetch: wire.fetch }) };
}

describe('opening a Zibal payment', () => {
    it('asks for the price in RIAL, ten times the Toman the shop thinks in', async () => {
        const { gateway, calls } = zibal({
            request: { trackId: 15966442233311, result: 100, message: 'success' }
        });

        const opened = await gateway.request(ORDER);

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://zibal.test/v1/request');
        expect(calls[0].body).toEqual({
            merchant: 'merchant-abc',
            amount: RIAL,
            callbackUrl: ORDER.callbackUrl,
            description: ORDER.description
        });
        expect(opened).toEqual({
            ok: true,
            authority: '15966442233311',
            payUrl: 'https://zibal.test/start/15966442233311'
        });
    });

    it('sends nothing that identifies the order or the buyer', async () => {
        const { gateway, calls } = zibal({ request: { trackId: 7, result: 100 } });
        await gateway.request(ORDER);

        // The only id an order has is its receipt token, which is the bearer handle the code
        // is read back with. It must not end up in a third party's transaction report.
        expect(calls[0].body).not.toHaveProperty('orderId');
        expect(JSON.stringify(calls[0].body)).not.toContain('buyer@example.com');
    });

    it('refuses when Zibal does, and says which code', async () => {
        const { gateway } = zibal({ request: { result: 102, message: 'merchant not found' } });
        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason: 'request failed (code 102)'
        });
    });

    it('refuses a success that carries no usable track id', async () => {
        // Past 2^53 a number has already been rounded by the time it is read, so it names a
        // different payment. Opening one we could not find again is worse than not opening it.
        for (const trackId of [undefined, 0, -4, 'abc', 2 ** 53]) {
            const { gateway } = zibal({ request: { trackId, result: 100 } });
            expect((await gateway.request(ORDER)).ok).toBe(false);
        }
    });

    it('treats a dead network as a refusal rather than a crash', async () => {
        const { gateway } = zibal({});
        expect(await gateway.request(ORDER)).toEqual({
            ok: false,
            reason: 'request failed (code none)'
        });
    });
});

describe('verifying a Zibal payment', () => {
    const PAID = { result: 100, status: 1, amount: RIAL, refNumber: 12312, message: 'success' };

    it('confirms a payment for our own sum and keeps the bank reference', async () => {
        const { gateway, calls } = zibal({ verify: PAID });

        expect(await gateway.verify('15966442233311', TOMAN)).toEqual({
            ok: true,
            refId: 12312,
            alreadyVerified: false
        });
        // The track id goes back as the NUMBER Zibal issued, and nothing else goes with it:
        // verify takes no amount, which is why the answer has to be checked below.
        expect(calls).toEqual([
            {
                url: 'https://zibal.test/v1/verify',
                body: { merchant: 'merchant-abc', trackId: 15966442233311 }
            }
        ]);
    });

    it('refuses a verified payment for a different sum', async () => {
        // THE TEST THIS FILE EXISTS FOR. Zibal is not told what we expect, so a success for a
        // tenth of the price is still a success as far as it is concerned.
        const { gateway } = zibal({ verify: { ...PAID, amount: TOMAN } });
        expect(await gateway.verify('42', TOMAN)).toEqual({
            ok: false,
            reason: 'verify answered for a different payment'
        });
    });

    it('refuses a success whose status is not "paid and verified"', async () => {
        const { gateway } = zibal({ verify: { ...PAID, status: 2 } });
        expect((await gateway.verify('42', TOMAN)).ok).toBe(false);
    });

    it('accepts "already verified" once inquiry confirms the same payment', async () => {
        // 201 is what is left when the first verify succeeded and its answer never arrived.
        // Refusing it would strand exactly the buyer whose payment was caught in a timeout.
        const { gateway, calls } = zibal({
            verify: { result: 201, message: 'previously verifed' },
            inquiry: PAID
        });

        expect(await gateway.verify('42', TOMAN)).toEqual({
            ok: true,
            refId: 12312,
            alreadyVerified: true
        });
        expect(calls.map((call) => call.url)).toEqual([
            'https://zibal.test/v1/verify',
            'https://zibal.test/v1/inquiry'
        ]);
        expect(calls[1].body).toEqual({ merchant: 'merchant-abc', trackId: 42 });
    });

    it('does not take "already verified" on trust', async () => {
        // A 201 with an inquiry that disagrees - another sum, a refund, no answer at all - is
        // not a payment of this order.
        const disagreements = [
            { ...PAID, amount: RIAL - 10 },
            { ...PAID, status: 15 },
            { result: 203 },
            undefined
        ];
        for (const inquiry of disagreements) {
            const { gateway } = zibal({ verify: { result: 201 }, inquiry });
            expect((await gateway.verify('42', TOMAN)).ok).toBe(false);
        }
    });

    it('refuses an unpaid or unknown payment, and says which code', async () => {
        const { gateway } = zibal({ verify: { result: 202, status: 3 } });
        expect(await gateway.verify('42', TOMAN)).toEqual({
            ok: false,
            reason: 'verify failed (code 202)'
        });
    });

    it('never asks Zibal about a handle that is not a track id', async () => {
        const { gateway, calls } = zibal({ verify: PAID });
        expect((await gateway.verify('A00000000000000000000000000000000001', TOMAN)).ok).toBe(
            false
        );
        expect(calls).toHaveLength(0);
    });

    it('reads a bank reference that arrives as a string', async () => {
        const { gateway } = zibal({ verify: { ...PAID, refNumber: '998877' } });
        expect(await gateway.verify('42', TOMAN)).toMatchObject({ refId: 998877 });
    });

    it('falls back to the track id when the bank gives no reference', async () => {
        // Every test payment answers `refNumber: null`. A paid order must still carry a number
        // somebody can quote, and the track id is the one Zibal's own panel searches by.
        const { gateway } = zibal({ verify: { ...PAID, refNumber: null } });
        expect(await gateway.verify('42', TOMAN)).toEqual({
            ok: true,
            refId: 42,
            alreadyVerified: false
        });
    });
});

/** A gateway that records who was asked what, and answers with its own name in the handle. */
function named(name: string) {
    const asked: Array<{ authority: string; toman: number }> = [];
    const gateway: PaymentGateway = {
        request: (): Promise<RequestResult> =>
            Promise.resolve({
                ok: true,
                authority: `${name}-handle`,
                payUrl: `https://${name}.test/pay`
            }),
        verify: (authority, toman): Promise<VerifyResult> => {
            asked.push({ authority, toman });
            return Promise.resolve({ ok: true, refId: 1, alreadyVerified: false });
        }
    };
    return { gateway, asked };
}

function wired(initial: 'zarinpal' | 'zibal') {
    const state = { active: initial };
    const zarinpal = named('zarinpal');
    const zibalSide = named('zibal');
    const payment = createGatewaySwitch({
        active: () => state.active,
        zarinpal: zarinpal.gateway,
        zibal: zibalSide.gateway
    });
    return { state, payment, zarinpal, zibal: zibalSide };
}

describe('the gateway switch', () => {
    it('opens a payment on whichever gateway is active at that moment', async () => {
        const { state, payment } = wired('zarinpal');
        expect(await payment.request(ORDER)).toMatchObject({
            authority: 'zarinpal-handle',
            payUrl: 'https://zarinpal.test/pay'
        });

        // No restart between these two lines: the choice is read per payment.
        state.active = 'zibal';
        expect(await payment.request(ORDER)).toMatchObject({
            authority: 'zibal:zibal-handle',
            payUrl: 'https://zibal.test/pay'
        });
    });

    it('verifies with the gateway that OPENED the payment, not the one active now', async () => {
        const { state, payment, zarinpal, zibal: zibalSide } = wired('zarinpal');
        const opened = await payment.request(ORDER);
        if (!opened.ok) {
            throw new Error('the fake gateway refused');
        }

        // The operator switches while the buyer is still on Zarinpal's page.
        state.active = 'zibal';
        await payment.verify(opened.authority, TOMAN);

        expect(zarinpal.asked).toEqual([{ authority: 'zarinpal-handle', toman: TOMAN }]);
        expect(zibalSide.asked).toHaveLength(0);
    });

    it('hands Zibal its own track id back, without the marker', async () => {
        const { state, payment, zarinpal, zibal: zibalSide } = wired('zibal');
        const opened = await payment.request(ORDER);
        if (!opened.ok) {
            throw new Error('the fake gateway refused');
        }

        state.active = 'zarinpal';
        await payment.verify(opened.authority, TOMAN);

        expect(zibalSide.asked).toEqual([{ authority: 'zibal-handle', toman: TOMAN }]);
        expect(zarinpal.asked).toHaveLength(0);
    });

    it('passes a refusal through untouched', async () => {
        const refusing: PaymentGateway = {
            request: () => Promise.resolve({ ok: false, reason: 'request failed (code 102)' }),
            verify: () => Promise.resolve({ ok: false, reason: 'unused' })
        };
        const payment = createGatewaySwitch({
            active: () => 'zibal',
            zarinpal: refusing,
            zibal: refusing
        });
        expect(await payment.request(ORDER)).toEqual({
            ok: false,
            reason: 'request failed (code 102)'
        });
    });
});

describe("reading a gateway's return", () => {
    it("reads Zibal's spelling into the stored form of the handle", () => {
        expect(readReturn({ trackId: '9900', success: '1', status: '2', orderId: '1' })).toEqual({
            authority: 'zibal:9900',
            saidOk: true
        });
        expect(readReturn({ trackId: '9900', success: '0', status: '3' })).toEqual({
            authority: 'zibal:9900',
            saidOk: false
        });
    });

    it("reads Zarinpal's spelling exactly as it always was", () => {
        expect(readReturn({ Authority: 'A0001', Status: 'OK' })).toEqual({
            authority: 'A0001',
            saidOk: true
        });
        expect(readReturn({ Authority: 'A0001', Status: 'NOK' })).toEqual({
            authority: 'A0001',
            saidOk: false
        });
    });

    it('finds nothing in a return that names no payment', () => {
        expect(readReturn({})).toBeNull();
        expect(readReturn({ trackId: '', Authority: '' })).toBeNull();
        expect(readReturn({ success: '1', Status: 'OK' })).toBeNull();
    });

    it('is not fooled by a repeated parameter', () => {
        // `?trackId=1&trackId=2` arrives as an array. It names no single payment, so it is
        // treated as naming none rather than being handed to the database.
        expect(readReturn({ trackId: ['1', '2'], success: '1' })).toBeNull();
        expect(readReturn({ Authority: ['A', 'B'], Status: 'OK' })).toBeNull();
    });
});
