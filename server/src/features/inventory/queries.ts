// The gift-code inventory.
//
// THE ONE THING THIS MODULE GUARANTEES: two buyers never receive one code. `claim` is a
// single UPDATE whose subquery picks a free row and LOCKS it, skipping any row another
// checkout has already locked - so the database decides the winner rather than application
// timing, and two checkouts at once take two different codes instead of queueing for one.
// Everything else here counts what that statement left behind.
import type { Database, Sql } from '../../platform/db.ts';
import { phoneSearchVariants } from '../../domain/phone.ts';
import { UUID } from '../../domain/codes.ts';
import type {
    Amount,
    AddCodesResult,
    CodeQuery,
    CodeRow,
    CodeState,
    StockLine,
    Tier
} from '../../db/types.ts';

export interface CodeQueries {
    stock(tiers: Tier[]): Promise<StockLine[]>;
    availableFor(amount: Amount): Promise<number>;
    addCodes(amount: Amount, codes: string[]): Promise<AddCodesResult>;
    searchCodes(query: CodeQuery): Promise<{ rows: CodeRow[]; total: number }>;

    /** Frees holds whose window has passed, so an abandoned tab cannot sit on stock. */
    sweep(): Promise<void>;

    /**
     * The claim itself, shared with the order module - one payment, one code. Answers the
     * code it took, or null when the denomination has none free. On `sql`, so it can be one
     * statement of a transaction.
     */
    claim(
        sql: Sql,
        orderId: string,
        holdUntil: number | null,
        amount: Amount
    ): Promise<string | null>;

    /** Returns whatever `orderId` holds to stock. */
    release(sql: Sql, orderId: string): Promise<void>;

    /**
     * Turns the hold `orderId` has into a sale and answers the code, or null when it holds
     * none. One statement, so the sweep cannot free the code between reading and keeping it.
     */
    keepCode(sql: Sql, orderId: string): Promise<string | null>;
}

// The claim. The subquery picks the oldest free row for the denomination and locks it, passing
// over rows another transaction holds; the UPDATE stamps it with the order. No row back means
// sold out.
const CLAIM = `
    UPDATE codes SET order_id = $1, hold_until = $2
    WHERE id = (
        SELECT id FROM codes
        WHERE amount = $3 AND order_id IS NULL
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING code`;

// The inventory, joined to whoever received each code. The join is on orders.code rather
// than codes.order_id: a code that was DELIVERED is stamped on the order, which stays true
// even after a hold is recycled, so this reports where the code actually went.
const CODE_STATE = `CASE
    WHEN o.id IS NOT NULL THEN 'sold'
    WHEN c.order_id IS NOT NULL THEN 'held'
    ELSE 'free' END`;
const CODE_MATCHES = `(
    ($1 = '' OR c.code LIKE $2 OR o.phone LIKE $3 OR o.phone LIKE $4)
    AND ($5 = '' OR ${CODE_STATE} = $5)
    AND ($6 = 0 OR c.amount = $6)
)`;

export function createCodeQueries(db: Database): CodeQueries {
    async function sweep(): Promise<void> {
        await db.run(
            'UPDATE codes SET order_id = NULL, hold_until = NULL WHERE hold_until IS NOT NULL AND hold_until < $1',
            [Date.now()]
        );
    }

    return {
        sweep,

        async claim(sql, orderId, holdUntil, amount) {
            const claimed = await sql.row<{ code: string }>(CLAIM, [orderId, holdUntil, amount]);
            return claimed?.code ?? null;
        },

        async release(sql, orderId) {
            await sql.run(
                'UPDATE codes SET order_id = NULL, hold_until = NULL WHERE order_id = $1',
                [orderId]
            );
        },

        async keepCode(sql, orderId) {
            const kept = await sql.row<{ code: string }>(
                'UPDATE codes SET hold_until = NULL WHERE order_id = $1 RETURNING code',
                [orderId]
            );
            return kept?.code ?? null;
        },

        async stock(tiers) {
            await sweep();
            const counted = await db.rows<{
                amount: number;
                available: number;
                held: number;
                sold: number;
            }>(`
                SELECT amount,
                       COUNT(*) FILTER (WHERE order_id IS NULL)                                AS available,
                       COUNT(*) FILTER (WHERE order_id IS NOT NULL AND hold_until IS NOT NULL) AS held,
                       COUNT(*) FILTER (WHERE order_id IS NOT NULL AND hold_until IS NULL)     AS sold
                FROM codes GROUP BY amount`);
            const byAmount = new Map(counted.map((row) => [row.amount, row]));
            // Driven by the CATALOGUE, not by what happens to be in the codes table: a tier
            // with no codes still has to appear, saying zero, or the operator cannot see
            // that it is the one that needs restocking. Retired tiers that still hold sold
            // codes are appended, so their history does not vanish from the strip.
            const lines = tiers.map((tier) => {
                const row = byAmount.get(tier.amount);
                byAmount.delete(tier.amount);
                return {
                    amount: tier.amount,
                    available: row?.available ?? 0,
                    held: row?.held ?? 0,
                    sold: row?.sold ?? 0
                };
            });
            return [...lines, ...byAmount.values()];
        },

        async availableFor(amount) {
            await sweep();
            const row = await db.row<{ n: number }>(
                'SELECT COUNT(*) AS n FROM codes WHERE amount = $1 AND order_id IS NULL',
                [amount]
            );
            return row?.n ?? 0;
        },

        async addCodes(amount, codes) {
            const result: AddCodesResult = { added: 0, duplicate: 0, invalid: [] };
            const fresh: string[] = [];
            const seen = new Set<string>();
            for (const raw of codes) {
                const code = raw.trim().toLowerCase();
                if (code === '') {
                    continue;
                }
                if (!UUID.test(code)) {
                    result.invalid.push(raw.trim());
                    continue;
                }
                // A repeat WITHIN the paste is a duplicate too; the insert below would only
                // ever see it once, and the operator would be told a wrong number.
                if (seen.has(code)) {
                    result.duplicate += 1;
                    continue;
                }
                seen.add(code);
                fresh.push(code);
            }
            if (fresh.length > 0) {
                // ONE statement for the whole paste, so it lands whole or not at all. The ids
                // follow the paste's order, which is the order a checkout claims them in; a
                // code the table already holds is skipped, and only the ones that landed come
                // back.
                const added = await db.rows<{ code: string }>(
                    `INSERT INTO codes (amount, code, added_at)
                     SELECT $1::integer, pasted.code, $3::text
                     FROM unnest($2::text[]) WITH ORDINALITY AS pasted (code, at)
                     ORDER BY pasted.at
                     ON CONFLICT (code) DO NOTHING
                     RETURNING code`,
                    [amount, fresh, new Date().toISOString()]
                );
                result.added = added.length;
                result.duplicate += fresh.length - added.length;
            }
            return result;
        },

        async searchCodes(query) {
            const term = query.search.trim().toLowerCase();
            const like = `%${term}%`;
            const phoneLike = phoneSearchVariants(term).map((variant) => `%${variant}%`);
            const bind = [
                term,
                like,
                phoneLike[0] ?? like,
                phoneLike[1] ?? like,
                query.state ?? '',
                query.amount ?? 0
            ];
            const rows = await db.rows<{
                code: string;
                amount: number;
                added_at: string;
                state: string;
                phone: string | null;
                sold_at: string | null;
                ref_id: number | null;
            }>(
                `SELECT c.code, c.amount, c.added_at, ${CODE_STATE} AS state,
                        o.phone AS phone, o.settled_at AS sold_at, o.ref_id AS ref_id
                 FROM codes c LEFT JOIN orders o ON o.code = c.code
                 WHERE ${CODE_MATCHES}
                 ORDER BY c.id DESC
                 LIMIT $7 OFFSET $8`,
                [...bind, query.limit, query.offset]
            );
            const counted = await db.row<{ n: number }>(
                `SELECT COUNT(*) AS n
                 FROM codes c LEFT JOIN orders o ON o.code = c.code
                 WHERE ${CODE_MATCHES}`,
                bind
            );

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
                total: counted?.n ?? 0
            };
        }
    };
}
