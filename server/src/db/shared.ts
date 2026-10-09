// The order row's shape. `shaped` lives in platform/db.ts, and the UUID a code has to match
// moved to domain/codes.ts when the redemption route started needing it too.
//
// New mobile numbers are stored in one canonical form, so the ledger can search directly while
// retaining and matching historical email addresses moved into the phone column.
import type { Order, OrderStatus } from './types.ts';

/** The row shape SQLite returns for an order; booleans are integers and there are no unions. */
export interface OrderRow {
    id: string;
    authority: string | null;
    amount: number;
    toman: number;
    phone: string;
    status: string;
    code: string | null;
    ref_id: number | null;
    sms_delivered: number;
    created_at: string;
    settled_at: string | null;
}

export function toOrder(row: OrderRow): Order {
    return {
        id: row.id,
        authority: row.authority,
        amount: row.amount,
        toman: row.toman,
        phone: row.phone,
        status: row.status as OrderStatus,
        code: row.code,
        refId: row.ref_id,
        smsDelivered: row.sms_delivered === 1,
        createdAt: row.created_at,
        settledAt: row.settled_at
    };
}
