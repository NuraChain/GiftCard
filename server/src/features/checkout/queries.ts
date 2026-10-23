// The order ledger, and the transactions that move a purchase through its life.
//
// The cross-table operations live HERE rather than in the codes module because the
// transaction is the unit, not the table: claiming a code and creating the order it belongs
// to is one indivisible act, and so is settling a payment.
//
// EVERY TRANSACTION HERE TAKES THE ORDER'S ROW BEFORE THE CODE IT HOLDS. Two of them over one
// order therefore queue rather than interleave, and never wait on each other in a circle.
import type { CodeQueries } from '../inventory/queries.ts';
import type { Database } from '../../platform/db.ts';
import { isUniqueViolation } from '../../platform/db.ts';
import { toOrder, type OrderRow } from '../../db/shared.ts';
import type { NewOrder, Order, OrderQuery } from '../../db/types.ts';
import { phoneSearchVariants } from '../../domain/phone.ts';

export interface OrderQueries {
    startOrder(order: NewOrder, holdMs: number): Promise<boolean>;
    attachAuthority(orderId: string, authority: string): Promise<boolean>;
    abandonOrder(orderId: string): Promise<void>;
    orderById(id: string): Promise<Order | undefined>;
    orderByAuthority(authority: string): Promise<Order | undefined>;
    pendingOrders(prefix: string, since: string): Promise<Order[]>;
    rememberPayment(authority: string, paymentId: string): Promise<void>;
    paymentsFor(authority: string): Promise<string[]>;
    settlePaid(orderId: string, refId: number): Promise<string | null>;
    settleUnpaid(orderId: string, status: 'cancelled' | 'failed'): Promise<void>;
    markSmsDelivered(orderId: string, delivered: boolean): Promise<void>;
    recentOrders(limit: number): Promise<Order[]>;
    searchOrders(query: OrderQuery): Promise<{ rows: Order[]; total: number }>;
    owedCount(): Promise<number>;
}

/**
 * PostgreSQL text cannot hold a NUL, so no stored key contains one - and a lookup by one is
 * refused as an error rather than answered as the miss it is. Both lookups below take a key a
 * stranger wrote: a receipt link, a gateway's redirect.
 */
const unstorable = (key: string): boolean => key.includes('\u0000');

// Owed orders first: money taken, no code. They are the only rows needing a human.
const LEDGER_ORDER = "(status = 'paid' AND code IS NULL) DESC, created_at DESC";

// One WHERE clause, shared by the page and its count so the two can never disagree. The phone
// column holds a canonical mobile number on a Persian order and a canonical email on an
// English one, so the substring search finds either.
const MATCHES = `(
    $1 = ''
    OR id = $1
    OR phone LIKE $2
    OR phone LIKE $3
    OR code LIKE $4
    OR ref_id::text LIKE $4
)`;

export function createOrderQueries(db: Database, codes: CodeQueries): OrderQueries {
    return {
        async startOrder(order, holdMs) {
            await codes.sweep();
            return db.transaction(async (tx) => {
                if ((await codes.claim(tx, order.id, Date.now() + holdMs, order.amount)) === null) {
                    return false;
                }
                await tx.run(
                    `INSERT INTO orders (id, authority, amount, toman, phone, status, code, ref_id, sms_delivered, created_at, settled_at, lang)
                     VALUES ($1, NULL, $2, $3, $4, 'pending', NULL, NULL, FALSE, $5, NULL, $6)`,
                    [order.id, order.amount, order.toman, order.phone, order.createdAt, order.lang]
                );
                return true;
            });
        },

        async attachAuthority(orderId, authority) {
            try {
                await db.run('UPDATE orders SET authority = $1 WHERE id = $2', [
                    authority,
                    orderId
                ]);
                return true;
            } catch (error) {
                // The unique index on `authority` is the guard: one gateway handle, one
                // order, always. Hitting it is the database refusing an ambiguity, not a
                // crash to propagate.
                if (isUniqueViolation(error)) {
                    return false;
                }
                throw error;
            }
        },

        async abandonOrder(orderId) {
            await db.transaction(async (tx) => {
                await tx.run('DELETE FROM orders WHERE id = $1', [orderId]);
                await codes.release(tx, orderId);
            });
        },

        async orderById(id) {
            if (unstorable(id)) {
                return undefined;
            }
            const row = await db.row<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
            return row === undefined ? undefined : toOrder(row);
        },

        async orderByAuthority(authority) {
            if (unstorable(authority)) {
                return undefined;
            }
            const row = await db.row<OrderRow>('SELECT * FROM orders WHERE authority = $1', [
                authority
            ]);
            return row === undefined ? undefined : toOrder(row);
        },

        async pendingOrders(prefix, since) {
            // `starts_with` rather than LIKE: a prefix is matched literally, with no wildcard
            // to escape.
            const rows = await db.rows<OrderRow>(
                `SELECT * FROM orders
                 WHERE status = 'pending' AND starts_with(authority, $1) AND created_at >= $2
                 ORDER BY created_at`,
                [prefix, since]
            );
            return rows.map(toOrder);
        },

        async rememberPayment(authority, paymentId) {
            await db.run(
                'INSERT INTO gateway_payments (authority, payment_id) VALUES ($1, $2) ON CONFLICT (authority, payment_id) DO NOTHING',
                [authority, paymentId]
            );
        },

        async paymentsFor(authority) {
            const rows = await db.rows<{ payment_id: string }>(
                'SELECT payment_id FROM gateway_payments WHERE authority = $1 ORDER BY id',
                [authority]
            );
            return rows.map((row) => row.payment_id);
        },

        async settlePaid(orderId, refId) {
            return db.transaction(async (tx) => {
                // The order's row first, held to the end: a second settlement of the same
                // order waits here, and then finds the code this one kept rather than taking
                // a second from stock.
                const order = await tx.row<{ amount: number }>(
                    'SELECT amount FROM orders WHERE id = $1 FOR UPDATE',
                    [orderId]
                );
                // The usual case: the hold survived, so the buyer gets the code reserved at
                // checkout. Clearing the hold is what turns a reservation into a sale.
                let code = await codes.keepCode(tx, orderId);
                if (code === null && order !== undefined) {
                    // The hold lapsed and the code went back to stock before this payment
                    // landed. The money is real, so take any free code of the denomination.
                    code = await codes.claim(tx, orderId, null, order.amount);
                }
                // A null code here is the owed state, and it is still `paid`: pretending a
                // verified payment failed would be a lie about money that has moved.
                await tx.run(
                    "UPDATE orders SET status = 'paid', code = $1, ref_id = $2, settled_at = $3 WHERE id = $4",
                    [code, refId, new Date().toISOString(), orderId]
                );
                return code;
            });
        },

        async settleUnpaid(orderId, status) {
            await db.transaction(async (tx) => {
                await tx.run('UPDATE orders SET status = $1, settled_at = $2 WHERE id = $3', [
                    status,
                    new Date().toISOString(),
                    orderId
                ]);
                await codes.release(tx, orderId);
            });
        },

        async markSmsDelivered(orderId, delivered) {
            await db.run('UPDATE orders SET sms_delivered = $1 WHERE id = $2', [
                delivered,
                orderId
            ]);
        },

        async recentOrders(limit) {
            const rows = await db.rows<OrderRow>(
                `SELECT * FROM orders ORDER BY ${LEDGER_ORDER} LIMIT $1`,
                [limit]
            );
            return rows.map(toOrder);
        },

        async searchOrders(query) {
            const term = query.search.trim();
            const like = `%${term.toLowerCase()}%`;
            const phoneLike = phoneSearchVariants(term).map((variant) => `%${variant}%`);
            const bind = [term, phoneLike[0] ?? like, phoneLike[1] ?? like, like];
            const rows = await db.rows<OrderRow>(
                `SELECT * FROM orders WHERE ${MATCHES} ORDER BY ${LEDGER_ORDER} LIMIT $5 OFFSET $6`,
                [...bind, query.limit, query.offset]
            );
            const counted = await db.row<{ n: number }>(
                `SELECT COUNT(*) AS n FROM orders WHERE ${MATCHES}`,
                bind
            );
            return { rows: rows.map(toOrder), total: counted?.n ?? 0 };
        },

        async owedCount() {
            const row = await db.row<{ n: number }>(
                "SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND code IS NULL"
            );
            return row?.n ?? 0;
        }
    };
}
