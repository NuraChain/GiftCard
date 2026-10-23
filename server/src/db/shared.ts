// The order row's shape as PostgreSQL returns it, and how it becomes an Order.
import type { Order, OrderLang, OrderStatus } from './types.ts';

/** An order as it comes off the table; the unions are plain text here. */
export interface OrderRow {
    id: string;
    authority: string | null;
    amount: number;
    toman: number;
    phone: string;
    status: string;
    code: string | null;
    ref_id: number | null;
    sms_delivered: boolean;
    created_at: string;
    settled_at: string | null;
    lang: string;
}

export function toOrder(row: OrderRow): Order {
    return {
        id: row.id,
        authority: row.authority,
        amount: row.amount,
        toman: row.toman,
        phone: row.phone,
        lang: row.lang as OrderLang,
        status: row.status as OrderStatus,
        code: row.code,
        refId: row.ref_id,
        smsDelivered: row.sms_delivered,
        createdAt: row.created_at,
        settledAt: row.settled_at
    };
}
