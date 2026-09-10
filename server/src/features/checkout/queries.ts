// The order ledger, and the transactions that move a purchase through its life.
//
// The cross-table operations live HERE rather than in the codes module because the
// transaction is the unit, not the table: claiming a code and creating the order it belongs
// to is one indivisible act, and so is settling a payment.
import type { DatabaseSync } from 'node:sqlite';

import type { CodeQueries } from '../inventory/queries.ts';
import { shaped } from '../../platform/db.ts';
import { phoneNeedle, toOrder, type OrderRow } from '../../db/shared.ts';
import type { NewOrder, Order, OrderQuery } from '../../db/types.ts';

export interface OrderQueries {
    startOrder(order: NewOrder, holdMs: number): boolean;
    attachAuthority(orderId: string, authority: string): boolean;
    abandonOrder(orderId: string): void;
    orderById(id: string): Order | undefined;
    orderByAuthority(authority: string): Order | undefined;
    settlePaid(orderId: string, refId: number): string | null;
    settleUnpaid(orderId: string, status: 'cancelled' | 'failed'): void;
    markSmsDelivered(orderId: string, delivered: boolean): void;
    recentOrders(limit: number): Order[];
    searchOrders(query: OrderQuery): { rows: Order[]; total: number };
    owedCount(): number;
}

export function createOrderQueries(db: DatabaseSync, codes: CodeQueries): OrderQueries {
    const insertOrder = db.prepare(`
        INSERT INTO orders (id, authority, amount, toman, phone, status, code, ref_id, sms_delivered, created_at, settled_at)
        VALUES (?, NULL, ?, ?, ?, 'pending', NULL, NULL, 0, ?, NULL)`);
    const setAuthority = db.prepare('UPDATE orders SET authority = ? WHERE id = ?');
    const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');
    const selectById = db.prepare('SELECT * FROM orders WHERE id = ?');
    const selectByAuthority = db.prepare('SELECT * FROM orders WHERE authority = ?');
    const setPaid = db.prepare(
        "UPDATE orders SET status = 'paid', code = ?, ref_id = ?, settled_at = ? WHERE id = ?"
    );
    const setUnpaid = db.prepare('UPDATE orders SET status = ?, settled_at = ? WHERE id = ?');
    const setSms = db.prepare('UPDATE orders SET sms_delivered = ? WHERE id = ?');
    // Owed orders first: money taken, no code. They are the only rows needing a human.
    const selectRecent = db.prepare(`
        SELECT * FROM orders
        ORDER BY (status = 'paid' AND code IS NULL) DESC, created_at DESC
        LIMIT ?`);
    const countOwed = db.prepare(
        "SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND code IS NULL"
    );

    // One WHERE clause, shared by the page and its count so the two can never disagree.
    // A phone is stored as +989..., and an operator types 0917... or just a fragment, so the
    // phone arm matches on the digits that survive both spellings (see `phoneNeedle`).
    const MATCHES = `(
        ? = ''
        OR id = ?
        OR (? <> '' AND phone LIKE ?)
        OR code LIKE ?
        OR CAST(ref_id AS TEXT) LIKE ?
    )`;
    const searchPage = db.prepare(`
        SELECT * FROM orders WHERE ${MATCHES}
        ORDER BY (status = 'paid' AND code IS NULL) DESC, created_at DESC
        LIMIT ? OFFSET ?`);
    const searchCount = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${MATCHES}`);

    return {
        startOrder(order, holdMs) {
            codes.sweep();
            db.exec('BEGIN IMMEDIATE');
            try {
                if (!codes.claim(order.id, Date.now() + holdMs, order.amount)) {
                    db.exec('ROLLBACK');
                    return false;
                }
                insertOrder.run(order.id, order.amount, order.toman, order.phone, order.createdAt);
                db.exec('COMMIT');
                return true;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        attachAuthority(orderId, authority) {
            try {
                setAuthority.run(authority, orderId);
                return true;
            } catch {
                // The UNIQUE index on `authority` is the guard: one gateway handle, one
                // order, always. Hitting it is the database refusing an ambiguity, not a
                // crash to propagate.
                return false;
            }
        },

        abandonOrder(orderId) {
            db.exec('BEGIN IMMEDIATE');
            try {
                codes.release(orderId);
                deleteOrder.run(orderId);
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        orderById(id) {
            const row = shaped<OrderRow | undefined>(selectById.get(id));
            return row === undefined ? undefined : toOrder(row);
        },

        orderByAuthority(authority) {
            const row = shaped<OrderRow | undefined>(selectByAuthority.get(authority));
            return row === undefined ? undefined : toOrder(row);
        },

        settlePaid(orderId, refId) {
            db.exec('BEGIN IMMEDIATE');
            try {
                // The usual case: the hold survived, so the buyer gets the code reserved at
                // checkout. Clearing the hold is what turns a reservation into a sale.
                let code = codes.heldCode(orderId) ?? null;
                if (code === null) {
                    // The hold lapsed and the code went back to stock before this payment
                    // landed. The money is real, so take any free code of the denomination.
                    const order = shaped<OrderRow | undefined>(selectById.get(orderId));
                    if (order !== undefined && codes.claim(orderId, null, order.amount)) {
                        code = codes.heldCode(orderId) ?? null;
                    }
                } else {
                    codes.keepCode(orderId);
                }
                // A null code here is the owed state, and it is still `paid`: pretending a
                // verified payment failed would be a lie about money that has moved.
                setPaid.run(code, refId, new Date().toISOString(), orderId);
                db.exec('COMMIT');
                return code;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        settleUnpaid(orderId, status) {
            db.exec('BEGIN IMMEDIATE');
            try {
                codes.release(orderId);
                setUnpaid.run(status, new Date().toISOString(), orderId);
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        markSmsDelivered(orderId, delivered) {
            setSms.run(delivered ? 1 : 0, orderId);
        },

        recentOrders(limit) {
            return shaped<OrderRow[]>(selectRecent.all(limit)).map(toOrder);
        },

        searchOrders(query) {
            const term = query.search.trim();
            const like = `%${term.toLowerCase()}%`;
            const digits = phoneNeedle(term);
            const bind = [term, term, digits, `%${digits}%`, like, like];
            return {
                rows: shaped<OrderRow[]>(searchPage.all(...bind, query.limit, query.offset)).map(
                    toOrder
                ),
                total: shaped<{ n: number }>(searchCount.get(...bind)).n
            };
        },

        owedCount() {
            return shaped<{ n: number }>(countOwed.get()).n;
        }
    };
}
