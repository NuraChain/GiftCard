import { describe, expect, it, vi } from 'vitest';

import type { SmsResult, SmsSender } from '../src/features/checkout/panelsms.ts';
import {
    anyPayoutNotifier,
    createSmsPayoutNotifier,
    createSmsSaleNotifier,
    everySaleNotifier
} from '../src/features/redeem/notify.ts';
import type { PayoutNotifier, SaleNotifier } from '../src/features/telegram/notify.ts';

const PAYOUT = {
    amount: 25,
    wallet: 'TXYZabcdefghijkmnopqrstuvwxyz12345',
    network: 'TRC20',
    phone: '+989121234567',
    code: 'NC-1234-5678-9ABC',
    claimedAt: '2026-10-20T10:00:00.000Z'
};

const SALE = {
    amount: 10,
    toman: 1_000_000,
    phone: '+989121234567',
    refId: 123,
    receipt: 'r-1',
    remaining: 4,
    codeDelivered: true
};

function sms(result: SmsResult = { ok: true }) {
    const sendText = vi.fn<SmsSender['sendText']>(() => Promise.resolve(result));
    return { sendCode: vi.fn<SmsSender['sendCode']>(), sendText };
}

function notifier(result: Awaited<ReturnType<PayoutNotifier['redeemed']>>): PayoutNotifier {
    return { redeemed: () => Promise.resolve(result) };
}

const OPERATOR = { operatorPhone: () => '0912 765 4321', appName: () => 'اشبرینگر' };

describe('the payout ask by SMS', () => {
    it("texts the operator's phone that a code was redeemed", async () => {
        const sender = sms();
        const payouts = createSmsPayoutNotifier({ sms: sender, ...OPERATOR });

        expect(await payouts.redeemed(PAYOUT)).toEqual({ ok: true });
        // Canonical, as every other number the panel is handed.
        expect(sender.sendText.mock.calls).toEqual([
            ['+989127654321', 'یک کد ثبت شد\n\nفروشگاه اشبرینگر']
        ]);
    });

    it('sends nothing when no operator phone is set', async () => {
        for (const phone of ['', 'not a phone']) {
            const sender = sms();
            const payouts = createSmsPayoutNotifier({
                sms: sender,
                operatorPhone: () => phone,
                appName: () => 'اشبرینگر'
            });

            expect(await payouts.redeemed(PAYOUT), phone).toEqual({
                ok: false,
                reason: 'operator phone is not set'
            });
            expect(sender.sendText, phone).not.toHaveBeenCalled();
        }
    });

    it('passes on why the panel refused', async () => {
        const payouts = createSmsPayoutNotifier({
            sms: sms({ ok: false, reason: 'PanelSMS returned code -19: not enough panel credit' }),
            ...OPERATOR
        });

        expect(await payouts.redeemed(PAYOUT)).toEqual({
            ok: false,
            reason: 'PanelSMS returned code -19: not enough panel credit'
        });
    });
});

describe('the sale ping by SMS', () => {
    it("texts the operator's phone that a code was sold", () => {
        const sender = sms();
        createSmsSaleNotifier({ sms: sender, ...OPERATOR }).sold(SALE);

        expect(sender.sendText.mock.calls).toEqual([
            ['+989127654321', 'یک کد فروخته شد\n\nفروشگاه اشبرینگر']
        ]);
    });

    it('says so when the money was taken with no code to give', () => {
        const sender = sms();
        createSmsSaleNotifier({ sms: sender, ...OPERATOR }).sold({ ...SALE, codeDelivered: false });

        expect(sender.sendText.mock.calls[0][1]).toBe(
            'یک فروش بدون کد ثبت شد. رسیدگی کنید\n\nفروشگاه اشبرینگر'
        );
    });

    it('sends nothing when no operator phone is set', () => {
        const sender = sms();
        createSmsSaleNotifier({
            sms: sender,
            operatorPhone: () => '',
            appName: () => 'اشبرینگر'
        }).sold(SALE);

        expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('logs a refusal instead of throwing it at the sale', async () => {
        const warn = vi.fn<(...args: unknown[]) => void>();
        createSmsSaleNotifier({
            sms: sms({ ok: false, reason: 'PanelSMS is not configured' }),
            ...OPERATOR,
            log: { warn } as never
        }).sold(SALE);

        await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    });
});

describe('sending a sale down every road', () => {
    it('tells every notifier, even after one of them throws', () => {
        const told = vi.fn<SaleNotifier['sold']>();
        const both = everySaleNotifier(
            {
                sold: () => {
                    throw new Error('boom');
                }
            },
            { sold: told }
        );

        expect(() => both.sold(SALE)).not.toThrow();
        expect(told).toHaveBeenCalledWith(SALE);
    });
});

describe('sending the payout ask down every road', () => {
    it('counts as told when any one road got through', async () => {
        const both = anyPayoutNotifier(
            notifier({ ok: false, reason: 'telegram is not configured' }),
            notifier({ ok: true })
        );

        expect(await both.redeemed(PAYOUT)).toEqual({ ok: true });
    });

    it('says why every road failed when none did', async () => {
        const both = anyPayoutNotifier(
            notifier({ ok: false, reason: 'telegram is not configured' }),
            { redeemed: () => Promise.reject(new Error('boom')) }
        );

        expect(await both.redeemed(PAYOUT)).toEqual({
            ok: false,
            reason: 'telegram is not configured; notifier failed'
        });
    });

    it('asks every road, not only until one answers', async () => {
        const first = vi.fn<PayoutNotifier['redeemed']>(() => Promise.resolve({ ok: true }));
        const second = vi.fn<PayoutNotifier['redeemed']>(() => Promise.resolve({ ok: true }));

        await anyPayoutNotifier({ redeemed: first }, { redeemed: second }).redeemed(PAYOUT);

        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });
});
