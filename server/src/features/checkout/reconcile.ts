// The English shop's safety net: re-asking NOWPayments about every invoice still unsettled.
//
// A NOWPayments payment is settled by one of three things - NOWPayments' callback, the buyer's result
// page polling its receipt, or this. The first two both depend on something this shop does not
// control. The callback is an inbound request to a server in Iran from a company abroad, and
// can simply not arrive. The result page only polls while the buyer keeps the tab open, and a
// crypto payment can confirm long after they close it.
//
// Without this, either one failing is a buyer who PAID and got no code and no email, and
// nobody told. With it, the worst case is a few minutes' wait.
//
// IT CAN ONLY READ WHAT IT HAS BEEN POINTED AT. NOWPayments lets the API key read a payment
// but not an invoice, so a sweep re-reads the payments the IPN or the buyer's return already
// named (see ./nowpayments.ts, rule 2). An order no payment is known for is skipped without a
// call - which is what makes a seven-day window cheap.
//
// It goes through the same `settle` as everything else, so it inherits every rule in
// ./checkout.ts: a pending invoice stays pending, a paid one is settled once, and it shares the
// in-flight settlement with a callback that lands at the same moment.
import type { Logger } from '../../platform/logging.ts';

import type { Store } from '../../db/index.ts';
import type { Checkout } from './checkout.ts';
import { NOWPAYMENTS_PREFIX } from './gateway.ts';

export interface ReconcilerOptions {
    store: Store;
    checkout: Checkout;

    /** How often to sweep. Every two minutes by default. */
    everyMs?: number;

    /**
     * How far back to look. Seven days by default: the life of a NOWPayments payment, which
     * expires if nothing is sent within that window. An order older than this is the
     * operator's to resolve from NOWPayments' own panel, not a timer's.
     */
    windowMs?: number;

    log?: Logger;
}

export interface Reconciler {
    /** One sweep, now. Resolves when every order in it has been asked about. */
    runOnce(): Promise<void>;

    /** Starts the timer and returns the function that stops it. */
    start(): () => void;
}

export function createReconciler(options: ReconcilerOptions): Reconciler {
    const { store, checkout, log } = options;
    const everyMs = options.everyMs ?? 2 * 60 * 1000;
    const windowMs = options.windowMs ?? 7 * 24 * 60 * 60 * 1000;
    let running = false;

    async function runOnce(): Promise<void> {
        // A sweep that is still waiting on NOWPayments when the next tick fires is not doubled up.
        if (running) {
            return;
        }
        running = true;
        try {
            const since = new Date(Date.now() - windowMs).toISOString();
            // One at a time, deliberately: a backlog of unsettled invoices must not become a
            // burst of calls against the same API key.
            for (const order of await store.pendingOrders(NOWPAYMENTS_PREFIX, since)) {
                await checkout.settle(order, true);
            }
        } catch (error) {
            log?.error({ err: error }, 'nowpayments reconciliation failed');
        } finally {
            running = false;
        }
    }

    return {
        runOnce,

        start() {
            const timer = setInterval(() => void runOnce(), everyMs);
            // The process must be free to exit with this still scheduled.
            timer.unref();
            return () => clearInterval(timer);
        }
    };
}
