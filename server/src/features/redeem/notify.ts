// The payout ask by SMS, to the operator's own phone - and the one notifier that sends it down
// every road there is.
//
// A REDEMPTION IS THE ONE MESSAGE THAT MUST ARRIVE: it is the only notice a human gets that
// somebody is owed a transfer (see features/telegram/notify.ts). One road is one outage away
// from a person waiting forever, so the ask goes by Telegram AND by SMS, at the same time, and
// it counts as told when EITHER got through. Only both failing is a payout nobody knows about.
//
// The SMS is SHORT on purpose. Every 70 Persian characters is another billed part, and the
// operator needs four things from it: how much, which chain, where, and that it is real. The
// address gets a line of its own for the same reason as in the chat - it is copied by tapping.
import { normalizePhone } from '../../domain/phone.ts';
import type { SmsSender } from '../checkout/panelsms.ts';
import type { Payout, PayoutNotifier } from '../telegram/notify.ts';

export interface SmsPayoutOptions {
    sms: SmsSender;

    /**
     * The operator's mobile, as the console holds it. Read PER REDEMPTION, like every other
     * setting, so a number fixed in the console is the one the next payout is sent to.
     */
    operatorPhone: () => string;

    appName: () => string;
}

/** As in the chat: enough of the spent code to find its row, nowhere near enough to use it. */
const CODE_PREFIX = 8;

export function createSmsPayoutNotifier(options: SmsPayoutOptions): PayoutNotifier {
    return {
        redeemed(payout: Payout) {
            const phone = normalizePhone(options.operatorPhone());
            if (phone === null) {
                return Promise.resolve({ ok: false, reason: 'operator phone is not set' });
            }
            const text = [
                `برداشت ${payout.amount} دلار USDT - ${options.appName()}`,
                `شبکه: ${payout.network}`,
                payout.wallet,
                `کد: ${payout.code.slice(0, CODE_PREFIX)}...`
            ].join('\n');
            return options.sms.sendText(phone, text);
        }
    };
}

/** Every notifier at once; told when any one of them got through. */
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
