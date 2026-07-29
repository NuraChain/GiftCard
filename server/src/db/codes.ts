// The gift-code inventory.
//
// THE ONE THING THIS MODULE GUARANTEES: two buyers never receive one code. `claim` is a
// single UPDATE whose subquery picks a free row, so the database decides the winner rather
// than application timing. Everything else here counts what that statement left behind.
import type { DatabaseSync } from 'node:sqlite';

import { shaped, phoneNeedle, UUID } from './shared.ts';
import type { Amount, AddCodesResult, CodeQuery, CodeRow, CodeState, StockLine, Tier } from './types.ts';

export interface CodeQueries
{
    stock(tiers: Tier[]): StockLine[];
    availableFor(amount: Amount): number;
    addCodes(amount: Amount, codes: string[]): AddCodesResult;
    searchCodes(query: CodeQuery): { rows: CodeRow[]; total: number };

    /** Frees holds whose window has passed, so an abandoned tab cannot sit on stock. */
    sweep(): void;

    /** The claim itself, shared with the order module - one payment, one code. */
    claim(orderId: string, holdUntil: number | null, amount: Amount): boolean;
    release(orderId: string): void;
    heldCode(orderId: string): string | undefined;
    keepCode(orderId: string): void;
}

export function createCodeQueries(db: DatabaseSync): CodeQueries
{
    const insertCode = db.prepare('INSERT OR IGNORE INTO codes (amount, code, added_at) VALUES (?, ?, ?)');
    const countStock = db.prepare(`
        SELECT amount,
               SUM(CASE WHEN order_id IS NULL THEN 1 ELSE 0 END)                                  AS available,
               SUM(CASE WHEN order_id IS NOT NULL AND hold_until IS NOT NULL THEN 1 ELSE 0 END)   AS held,
               SUM(CASE WHEN order_id IS NOT NULL AND hold_until IS NULL THEN 1 ELSE 0 END)       AS sold
        FROM codes GROUP BY amount`);
    const countAvailable = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE amount = ? AND order_id IS NULL');

    // The claim. The subquery picks the oldest free row for the denomination; the UPDATE
    // stamps it with the order. `changes === 0` means sold out.
    const claimStatement = db.prepare(`
        UPDATE codes SET order_id = ?, hold_until = ?
        WHERE id = (SELECT id FROM codes WHERE amount = ? AND order_id IS NULL ORDER BY id LIMIT 1)`);
    const releaseStatement = db.prepare('UPDATE codes SET order_id = NULL, hold_until = NULL WHERE order_id = ?');
    const heldCodeStatement = db.prepare('SELECT code FROM codes WHERE order_id = ? LIMIT 1');
    const keepCodeStatement = db.prepare('UPDATE codes SET hold_until = NULL WHERE order_id = ?');
    const expireHolds = db.prepare('UPDATE codes SET order_id = NULL, hold_until = NULL WHERE hold_until IS NOT NULL AND hold_until < ?');

    // The inventory, joined to whoever received each code. The join is on orders.code rather
    // than codes.order_id: a code that was DELIVERED is stamped on the order, which stays
    // true even after a hold is recycled, so this reports where the code actually went.
    const CODE_STATE = `CASE
        WHEN o.id IS NOT NULL THEN 'sold'
        WHEN c.order_id IS NOT NULL THEN 'held'
        ELSE 'free' END`;
    const CODE_MATCHES = `(
        (? = '' OR c.code LIKE ? OR (? <> '' AND o.phone LIKE ?))
        AND (? = '' OR ${ CODE_STATE } = ?)
        AND (? = 0 OR c.amount = ?)
    )`;
    const codePage = db.prepare(`
        SELECT c.code, c.amount, c.added_at, ${ CODE_STATE } AS state,
               o.phone AS phone, o.settled_at AS sold_at, o.ref_id AS ref_id
        FROM codes c LEFT JOIN orders o ON o.code = c.code
        WHERE ${ CODE_MATCHES }
        ORDER BY c.id DESC
        LIMIT ? OFFSET ?`);
    const codeCount = db.prepare(`
        SELECT COUNT(*) AS n
        FROM codes c LEFT JOIN orders o ON o.code = c.code
        WHERE ${ CODE_MATCHES }`);

    function sweep(): void
    {
        expireHolds.run(Date.now());
    }

    return {
        sweep,

        claim(orderId, holdUntil, amount)
        {
            return claimStatement.run(orderId, holdUntil, amount).changes === 1;
        },

        release(orderId)
        {
            releaseStatement.run(orderId);
        },

        heldCode(orderId)
        {
            return shaped<{ code: string } | undefined>(heldCodeStatement.get(orderId))?.code;
        },

        keepCode(orderId)
        {
            keepCodeStatement.run(orderId);
        },

        stock(tiers)
        {
            sweep();
            const counted = shaped<Array<{ amount: number; available: number; held: number; sold: number }>>(countStock.all());
            const byAmount = new Map(counted.map((row) => [row.amount, row]));
            // Driven by the CATALOGUE, not by what happens to be in the codes table: a tier
            // with no codes still has to appear, saying zero, or the operator cannot see
            // that it is the one that needs restocking. Retired tiers that still hold sold
            // codes are appended, so their history does not vanish from the strip.
            const lines = tiers.map((tier) =>
            {
                const row = byAmount.get(tier.amount);
                byAmount.delete(tier.amount);
                return {
                    amount: tier.amount,
                    available: row?.available ?? 0,
                    held: row?.held ?? 0,
                    sold: row?.sold ?? 0
                };
            });
            return [...lines, ...[...byAmount.values()]];
        },

    availableFor(amount)
    {
        sweep();
        return shaped<{ n: number }>(countAvailable.get(amount)).n;
    },

    addCodes(amount, codes)
    {
        const result: AddCodesResult = { added: 0, duplicate: 0, invalid: [] };
        const seen = new Set<string>();
        db.exec('BEGIN');
        try
        {
            for (const raw of codes)
            {
                const code = raw.trim().toLowerCase();
                if (code === '')
                {
                    continue;
                }
                if (!UUID.test(code))
                {
                    result.invalid.push(raw.trim());
                    continue;
                }
                // A repeat WITHIN the paste is a duplicate too; INSERT OR IGNORE would
                // report it as inserted-once and the operator would be told a wrong number.
                if (seen.has(code))
                {
                    result.duplicate += 1;
                    continue;
                }
                seen.add(code);
                const changes = insertCode.run(amount, code, new Date().toISOString()).changes;
                if (changes === 1)
                {
                    result.added += 1;
                }
                else
                {
                    result.duplicate += 1;
                }
            }
            db.exec('COMMIT');
        }
        catch (error)
        {
            db.exec('ROLLBACK');
            throw error;
        }
        return result;
    },

    searchCodes(query)
    {
        const term = query.search.trim().toLowerCase();
        const like = `%${ term }%`;
        const digits = phoneNeedle(term);
        const state = query.state ?? '';
        const amount = query.amount ?? 0;
        const bind = [term, like, digits, `%${ digits }%`, state, state, amount, amount];
        const rows = shaped<Array<{
            code: string;
            amount: number;
            added_at: string;
            state: string;
            phone: string | null;
            sold_at: string | null;
            ref_id: number | null;
        }>>(codePage.all(...bind, query.limit, query.offset));

        return {
            rows: rows.map((row) => ({
                code: row.code,
                amount: row.amount as Amount,
                state: row.state as CodeState,
                addedAt: row.added_at,
                phone: row.phone,
                soldAt: row.sold_at,
                refId: row.ref_id
            })),
            total: shaped<{ n: number }>(codeCount.get(...bind)).n
        };
    }
    };
}
