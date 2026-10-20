import { describe, expect, it, vi } from 'vitest';

import type { SmsResult, SmsSender } from '../src/features/checkout/panelsms.ts';
import { anyPayoutNotifier, createSmsPayoutNotifier } from '../src/features/redeem/notify.ts';
import type { PayoutNotifier } from '../src/features/telegram/notify.ts';

const PAYOUT = {
    amount: 25,
    wallet: 'TXYZabcdefghijkmnopqrstuvwxyz12345',
    network: 'TRC20',
    phone: '+989121234567',
    code: 'NC-1234-5678-9ABC',
    claimedAt: '2026-10-20T10:00:00.000Z'
};

function sms(result: SmsResult = { ok: true }) {
    const sendText = vi.fn<SmsSender['sendText']>(() => Promise.resolve(result));
    return { sendCode: vi.fn<SmsSender['sendCode']>(), sendText };
}

function notifier(result: Awaited<ReturnType<PayoutNotifier['redeemed']>>): PayoutNotifier {
    return { redeemed: () => Promise.resolve(result) };
}

describe('the payout ask by SMS', () => {
    it("texts the operator's phone with the amount, the chain and the address", async () => {
        const sender = sms();
        const payouts = createSmsPayoutNotifier({
            sms: sender,
            operatorPhone: () => '0912 765 4321',
            appName: () => 'اشبرینگر'
        });

        expect(await payouts.redeemed(PAYOUT)).toEqual({ ok: true });
        expect(sender.sendText).toHaveBeenCalledOnce();

        const [phone, text] = sender.sendText.mock.calls[0];
        // Canonical, as every other number the panel is handed.
        expect(phone).toBe('+989127654321');
        expect(text.split('\n')).toEqual([
            'برداشت 25 دلار USDT - اشبرینگر',
            'شبکه: TRC20',
            // A line of its own, so tapping it copies the address and nothing else.
            PAYOUT.wallet,
            'کد: NC-1234-...'
        ]);
        // Never the whole code: a text message is not where a spendable code belongs.
        expect(text).not.toContain(PAYOUT.code);
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
            operatorPhone: () => '09127654321',
            appName: () => 'اشبرینگر'
        });

        expect(await payouts.redeemed(PAYOUT)).toEqual({
            ok: false,
            reason: 'PanelSMS returned code -19: not enough panel credit'
        });
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
