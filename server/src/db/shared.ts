// Small things every query module needs.
import type { Order, OrderStatus } from './types.ts';

/**
 * SQLite hands back loose `Record<string, SQLOutputValue>` rows. Every query in this layer
 * selects known columns from the schema next door, so the shape is asserted HERE rather
 * than at each call site - one place to look when a column is renamed.
 */
export function shaped<T>(row: unknown): T
{
    return row as T;
}

/** The row shape SQLite returns for an order; booleans are integers and there are no unions. */
export interface OrderRow
{
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

export function toOrder(row: OrderRow): Order
{
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

/**
 * The digits of a phone search that survive every spelling of the same number. Numbers are
 * stored as `+989170459330`; an operator types `09170459330`, `9170459330`, or just
 * `917045`. Stripping the country code and the trunk zero leaves a fragment that is a
 * substring of the stored form in all four cases. Returns '' when the term is not a phone
 * search at all, which the query then skips instead of matching everything.
 */
export function phoneNeedle(term: string): string
{
    const digits = term.replace(/[\s\-().]/g, '').replace(/^(\+98|0098|98|0)/, '');
    return /^\d{3,}$/.test(digits) ? digits : '';
}

/** Canonical 8-4-4-4-4 hex. Anything else is handed back to the admin, not stored. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
