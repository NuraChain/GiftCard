// The money rules, with no HTTP in sight.
//
// This is the file to read before touching a payment. It used to be a closure inside the
// route wiring, which meant the four rules below could only be found by reading past a
// router.
//
// THE FOUR RULES:
//
//   1. The browser's return from the gateway proves NOTHING. `?Status=OK` is a string anyone
//      can type into an address bar, and so is `Status=NOK` - which would otherwise be a free
//      way to cancel a stranger's order and release their code. Status decides only the
//      WORDING when verification fails; verification decides everything else.
//   2. The amount sent to verify comes from OUR stored row. Taking it from the request is how
//      a five-dollar payment becomes a twenty-five-dollar card.
//   3. Settling is idempotent on `paid` only. Zarinpal answers 101 on every repeat verify -
//      exactly what a browser refresh produces - so a replay returns the same code and takes
//      nothing further from stock. Every other state re-verifies, because a `cancelled` order
//      was settled on the strength of an answer that could have been about a payment the
//      buyer went on to complete.
//   4. An SMS failure is a NOTICE, never a failed purchase. The code is already minted,
//      stored, and on the buyer's screen.
import type { Logger } from '../../platform/logging.ts';

import type { Order, Store } from '../../db/index.ts';
import type { PaymentGateway } from './zarinpal.ts';
import type { SmsSender } from './sms.ts';

export interface CheckoutOptions {
    store: Store;
    payment: PaymentGateway;
    sms: SmsSender;
    log?: Logger;
}

export interface Checkout {
    /**
     * Brings an order to rest against the gateway's answer. Safe to call repeatedly and
     * concurrently: calls for the same order share one in-flight settlement.
     */
    settle(order: Order, gatewaySaidOk: boolean): Promise<void>;
}

export function createCheckout(options: CheckoutOptions): Checkout {
    const { store, payment, sms, log } = options;

    // Settling is serialised per order. Without this, two callbacks arriving together (a
    // double-click on the gateway's return, a prefetching browser) would both see an
    // unsettled order, both verify, and both take a code from stock for one payment.
    const settling = new Map<string, Promise<void>>();

    async function settleOnce(order: Order, gatewaySaidOk: boolean): Promise<void> {
        if (order.status === 'paid') {
            return;
        }

        const verified = await payment.verify(order.authority ?? '', order.toman);
        if (!verified.ok) {
            store.settleUnpaid(order.id, gatewaySaidOk ? 'failed' : 'cancelled');
            log?.warn(
                { amount: order.amount, said: gatewaySaidOk, reason: verified.reason },
                'payment not verified'
            );
            return;
        }

        const code = store.settlePaid(order.id, verified.refId);
        if (code === null) {
            // Money verified with no code left to give. It is recorded as PAID because it
            // was paid; calling it a failure would be a lie about money that has moved.
            // The buyer sees an apology with their reference, the console pins the row.
            log?.error(
                { refId: verified.refId, amount: order.amount },
                'paid order has no code available'
            );
            return;
        }

        const sent = await sms.sendCode(order.phone, code);
        store.markSmsDelivered(order.id, sent.ok);
        if (!sent.ok) {
            log?.error(
                { refId: verified.refId, reason: sent.reason },
                'gift code SMS not delivered'
            );
        }
    }

    return {
        settle(order, gatewaySaidOk) {
            const inFlight = settling.get(order.id);
            if (inFlight !== undefined) {
                return inFlight;
            }
            const run = settleOnce(order, gatewaySaidOk).finally(() => settling.delete(order.id));
            settling.set(order.id, run);
            return run;
        }
    };
}
