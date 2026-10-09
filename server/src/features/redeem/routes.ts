// Redeeming a gift code: prove it, spend it once, and tell a human to send the money.
//
// THE ORDER OF THE FOUR STEPS IS THE WHOLE DESIGN, and each one is where it is for a reason:
//
//   1. normalise, 2. CHECKSUM THE ADDRESS, 3. spend the code, 4. notify.
//
// WHO CALLS THIS: Nura Wallet, with `{ code, wallet_address }` - the holder types the code
// into the wallet and the wallet supplies its own address. Nothing in this file trusts that:
// the route is public, so every rule below holds for any caller that can reach it.
//
// The checksum comes BEFORE the spend because a code consumed against a mistyped address is
// the worst outcome this file can produce - the holder has lost their card and the money has
// nowhere to go. Every cheap refusal is made while the code is still worth something.
//
// The spend comes BEFORE the notify because the alternative is worse. Notifying first and
// recording second means a crash in between leaves a live code that an operator has already
// been told to pay out on, which is a code that can be cashed twice. Recording first means a
// failed notification leaves a spent code nobody was told about - recoverable, because the
// row is in the database and `/status` counts it, and the holder is told plainly that the
// message did not get through. One failure needs a person to look; the other loses money.
//
// NOTHING HERE MOVES FUNDS. There is no wallet key on this machine and no transfer API. The
// route's entire output is a row and a chat message, which is a deliberate limit rather than
// an unfinished feature: an automated payout path would put a spendable key on a web server.
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/http.ts';
import type { contract } from '../../contract/index.ts';
import type { Store } from '../../db/index.ts';
import { normalizeGiftCode } from '../../domain/codes.ts';
import { checksumOk, readWallet } from '../../domain/wallet.ts';
import type { PayoutNotifier } from '../telegram/notify.ts';

export interface RedeemOptions {
    store: Store;

    /** The operator's ping. Its failure is recorded rather than thrown - see the header. */
    payouts: PayoutNotifier;

    log?: Logger;
}

/** Only this feature's route. app.ts mounts it as the whole `redeem` group. */
type RedeemHandlers = Handlers<typeof contract>['redeem'];

export function redeemHandlers(options: RedeemOptions): RedeemHandlers {
    const { store, payouts, log } = options;

    return {
        // POST /api/redeem
        submit: async ({ input }) => {
            // The schema proved the shapes; it does not canonicalise. A code read back off an
            // codes are case-insensitive and the inventory holds exactly one spelling - so
            // this is where the holder's typing becomes that spelling.
            const code = normalizeGiftCode(input.code);

            // ONE DESTINATION, UNDER EITHER NAME. `wallet_address` is what Nura Wallet sends
            // and `wallet` is what this route first took; a caller uses one. A refusal is
            // reported under the name the caller used, so its form can put the message
            // beside the right box.
            const field = input.wallet_address === undefined ? 'wallet' : 'wallet_address';
            const [named, alsoNamed] = [input.wallet_address, input.wallet].filter(
                (value) => value !== undefined
            );
            if (named === undefined) {
                throw new ValidationError(
                    { wallet_address: 'آدرس کیف پول را وارد کنید' },
                    'آدرس کیف پول وارد نشده است'
                );
            }

            const wallet = readWallet(named);

            // BOTH NAMES, TWO ADDRESSES. Nothing here can know which one was meant, and the
            // only thing worse than refusing is choosing: the code would be spent and the
            // money asked for at an address the holder may not have intended.
            if (alsoNamed !== undefined && readWallet(alsoNamed)?.address !== wallet?.address) {
                throw new ValidationError(
                    { wallet_address: 'دو آدرس متفاوت فرستاده شده است. فقط یکی را بفرستید.' },
                    'آدرس کیف پول مشخص نیست'
                );
            }

            if (code === null || wallet === null) {
                // Unreachable through the contract, which ran both rules already. It is here
                // because this handler must not depend on that for its correctness.
                throw new ValidationError({
                    code: code === null ? 'کد معتبر نیست' : '',
                    [field]: wallet === null ? 'آدرس کیف پول معتبر نیست' : ''
                });
            }

            // THE LAST FREE CHECK. After this line a mistake costs somebody their card, so
            // everything that can be refused for nothing is refused above it.
            if (!(await checksumOk(wallet))) {
                throw new ValidationError(
                    { [field]: 'این آدرس درست نیست. دوباره از کیف پول خودتان کپی کنید.' },
                    'آدرس کیف پول درست نیست'
                );
            }

            const result = store.redeemCode(code, wallet.address, wallet.network);

            if (result.state === 'unknown') {
                // ONE ANSWER FOR TWO CASES: no such code, and a code this shop holds but has
                // never sold. Telling them apart would confirm a guess at unsold inventory,
                // and the person on the other end can do nothing differently either way.
                log?.warn('redemption refused - unknown or unsold code');
                throw new NotFoundError('این کد معتبر نیست یا هنوز فروخته نشده است.');
            }

            if (result.state === 'spent') {
                // The date is quoted deliberately. "Already used" alone reads as an
                // accusation; "already used on this date" is something the holder can check
                // against their own memory, and is what support needs quoted back at them.
                throw new ConflictError(
                    `این کد قبلاً استفاده شده است (${result.at}). هر کد فقط یک بار قابل برداشت است.`
                );
            }

            const { redemption } = result;

            // Awaited, unlike a sale notification. This message is the only thing that tells
            // a human money is owed - see the header of features/telegram/notify.ts.
            const sent = await payouts.redeemed({
                amount: redemption.amount,
                wallet: redemption.wallet,
                network: redemption.network,
                phone: redemption.phone,
                code: redemption.code,
                claimedAt: redemption.claimedAt
            });

            if (sent.ok) {
                store.markRedemptionNotified(code);
            } else {
                // The code is spent and the operator does not know. The row stays, the count
                // shows up in the bot's /status, and this line is the other way to find it.
                log?.error(
                    { reason: sent.reason, amount: redemption.amount },
                    'REDEEMED BUT NOT NOTIFIED - a payout is owed and nobody has been told'
                );
            }

            return {
                amount: redemption.amount,
                network: redemption.network,
                wallet: redemption.wallet,
                at: redemption.claimedAt,
                notified: sent.ok
            };
        }
    };
}
