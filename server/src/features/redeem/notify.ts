// The operator's SMS - a ping on every sale and on every redemption - and the notifiers that
// send each of those down every road there is: Telegram AND SMS, at the same time.
//
// A REDEMPTION IS THE ONE MESSAGE THAT MUST ARRIVE: it is the only notice a human gets that
// somebody is owed a transfer (see features/telegram/notify.ts). One road is one outage away
// from a person waiting forever, so it counts as told when EITHER got through. Only both
// failing is a payout nobody knows about.
//
// A SALE IS FIRE-AND-FORGET on both roads, exactly as the chat's always was: `sold()` returns
// void so that no SMS panel can be put on the path between a buyer and their code.
//
// THE TEXTS ARE BARE ON PURPOSE: that something happened, and in which shop. The details -
// amount, address, network - are in the console and in the chat. An SMS is billed per part,
// and the panel refuses texts it does not like, which a wallet address can be.
import type { Logger } from '../../platform/logging.ts';
import { normalizePhone } from '../../domain/phone.ts';
import type { SmsSender } from '../checkout/panelsms.ts';
import type { Payout, PayoutNotifier, Sale, SaleNotifier } from '../telegram/notify.ts';

export interface OperatorSmsOptions {
    sms: SmsSender;

    /**
     * The operator's mobile, as the console holds it. Read PER MESSAGE, like every other
     * setting, so a number fixed in the console is the one the next message is sent to.
     */
    operatorPhone: () => string;

    appName: () => string;
}

export function createSmsPayoutNotifier(options: OperatorSmsOptions): PayoutNotifier {
    return {
        redeemed(_payout: Payout) {
            const phone = normalizePhone(options.operatorPhone());
            if (phone === null) {
                return Promise.resolve({ ok: false, reason: 'operator phone is not set' });
            }
            return options.sms.sendText(phone, `یک کد ثبت شد\n\nفروشگاه ${options.appName()}`);
        }
    };
}

export function createSmsSaleNotifier(
    options: OperatorSmsOptions & { log?: Logger }
): SaleNotifier {
    return {
        sold(sale: Sale) {
            const phone = normalizePhone(options.operatorPhone());
            if (phone === null) {
                return;
            }
            // The owed sale says so: money taken and no code to give is the one that needs
            // the operator now, not when they next open the console.
            const what = sale.codeDelivered
                ? 'یک کد فروخته شد'
                : 'یک فروش بدون کد ثبت شد. رسیدگی کنید';
            void options.sms
                .sendText(phone, `${what}\n\nفروشگاه ${options.appName()}`)
                .then((result) => {
                    if (!result.ok) {
                        options.log?.warn({ reason: result.reason }, 'sale SMS to operator failed');
                    }
                })
                .catch(() => {
                    options.log?.warn('sale SMS to operator failed');
                });
        }
    };
}

/** Every sale notifier at once. Each does its own sending in the background. */
export function everySaleNotifier(...notifiers: SaleNotifier[]): SaleNotifier {
    return {
        sold(sale) {
            for (const notifier of notifiers) {
                // One notifier throwing must not stop the next from being told.
                try {
                    notifier.sold(sale);
                } catch {
                    // Nothing to do: a notification is never allowed to break a sale.
                }
            }
        }
    };
}

/** Every payout notifier at once; told when any one of them got through. */
export function anyPayoutNotifier(...notifiers: PayoutNotifier[]): PayoutNotifier {
    return {
        async redeemed(payout) {
            // Side by side, not one after the other: a chat server that hangs for its whole
            // timeout must not hold the SMS - or the holder's answer - behind it.
            const results = await Promise.all(
                notifiers.map((notifier) =>
                    notifier
                        .redeemed(payout)
                        .catch(() => ({ ok: false as const, reason: 'notifier failed' }))
                )
            );
            if (results.some((result) => result.ok)) {
                return { ok: true };
            }
            return {
                ok: false,
                reason: results.map((result) => (result.ok ? '' : result.reason)).join('; ')
            };
        }
    };
}
