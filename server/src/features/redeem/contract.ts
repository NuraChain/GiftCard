// Cashing a gift code out to a wallet. Pairs with ./routes.ts - the shapes here, the rule
// there.
//
// THIS IS THE OTHER END OF THE SHOP. Checkout takes Toman and hands back a code; this takes
// the code back and asks for the code's value in USDT to be sent somewhere. Nothing here
// moves money by itself - the transfer is made by a human, off this machine, which is why the
// whole route amounts to "prove the code, spend it exactly once, and tell the operator".
//
// IT IS DELIBERATELY ANONYMOUS. No session, no email, no receipt handle - whoever holds the
// code may redeem it, because a gift card is bearer value and asking the holder to prove they
// were the buyer would break the one thing a gift is for. What replaces authentication is
// that the code is 122 bits of random and is consumed on first use.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { post } from '../../platform/contract.ts';
import { normalizeGiftCode } from '../../domain/codes.ts';
import { walletField } from '../../domain/wallet.ts';

/**
 * What a redemption asks for: the code, and where its value should go.
 *
 * Both fields VALIDATE ONLY - neither is canonicalised here. The handler runs
 * `normalizeGiftCode` and `readWallet` on what arrives, the same way `pay.start` runs
 * `normalizeEmail`, so nothing downstream may assume a stored spelling just because
 * validation passed.
 */
export const redeemInput = z.object({
    /**
     * The gift code, as the holder reads it back off their email. Case and surrounding
     * whitespace are forgiven here and normalised in the handler; anything that is not a
     * UUID at all is refused before a database is touched.
     */
    code: z
        .string()
        .trim()
        .max(64, { message: 'کد معتبر نیست' })
        .refine((value) => normalizeGiftCode(value) !== null, {
            message: 'کد معتبر نیست. کد ۳۶ نویسه‌ای داخل ایمیل را وارد کنید.'
        }),

    /**
     * The destination. Its SHAPE is checked here so a mistyped address is caught in the form;
     * its CHECKSUM is checked in the handler, before the code is spent, because verifying one
     * needs SHA-256 and that is asynchronous. See domain/wallet.ts for why both exist.
     */
    wallet: walletField
});

/**
 * The answer to a successful redemption.
 *
 * It reports what was RECORDED, never that a transfer has happened - because none has. The
 * operator sends it by hand, and a page that said "paid" here would be lying about money.
 */
export const redeemOutput = z.object({
    /** The denomination that was cashed out, in dollars. */
    amount: z.number().int(),

    /** The chain the operator has been asked to send on, derived from the address. */
    network: z.string(),

    /** The address as it was recorded, so the holder can check it against what they meant. */
    wallet: z.string(),

    /** When the code was spent. The code is dead from this moment, transfer or no transfer. */
    at: z.string(),

    /**
     * Whether the operator was actually reached.
     *
     * FALSE STILL MEANS THE CODE IS SPENT. The request is stored either way - the bot reports
     * unnotified ones in `/status` - but the holder is told plainly rather than left to
     * assume a message arrived, because the difference is how long they should wait before
     * asking a human.
     */
    notified: z.boolean()
});

export type RedeemInput = z.infer<typeof redeemInput>;
export type RedeemView = z.infer<typeof redeemOutput>;

/**
 * The one route, in its own group so the path is exactly `/api/redeem` rather than hanging
 * off `/pay` - redeeming is not paying, and the two have no session, no throttle budget and
 * no failure mode in common.
 */
export const redeemRoutes = {
    submit: post('/redeem', { input: redeemInput, output: redeemOutput })
};
