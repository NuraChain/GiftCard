// The order row's shape, and the UUID the inventory validates against. `shaped` lives in
// platform/db.ts.
//
// THE PHONE-SEARCH HELPER IS GONE and is not missed. A mobile number has four spellings that
// all mean the same number, so searching for one needed a helper that stripped the country
// code and the trunk zero to find a fragment common to all of them. An email address has ONE
// spelling - that is what `normalizeEmail` guarantees - so the ledger's search is a plain
// substring match and there is nothing to reconcile.
import type { Order, OrderStatus } from './types.ts';

/** The row shape SQLite returns for an order; booleans are integers and there are no unions. */
export interface OrderRow {
    id: string;
    authority: string | null;
    amount: number;
    toman: number;
    email: string;
    status: string;
    code: string | null;
    ref_id: number | null;
    mail_delivered: number;
    created_at: string;
    settled_at: string | null;
}

export function toOrder(row: OrderRow): Order {
    return {
        id: row.id,
        authority: row.authority,
        amount: row.amount,
        toman: row.toman,
        email: row.email,
        status: row.status as OrderStatus,
        code: row.code,
        refId: row.ref_id,
        mailDelivered: row.mail_delivered === 1,
        createdAt: row.created_at,
        settledAt: row.settled_at
    };
}

/** Canonical 8-4-4-4-4 hex. Anything else is handed back to the admin, not stored. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
