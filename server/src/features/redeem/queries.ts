// Spending a gift code, and the single statement that makes it unrepeatable.
//
// THE ONE THING THIS MODULE GUARANTEES: a code pays out once. It is the same guarantee
// features/inventory/queries.ts makes about handing a code to a buyer, and it is kept the
// same way - by letting the DATABASE decide the winner rather than application timing. There
// `claim` is an UPDATE whose subquery locks a free row; here it is an INSERT against a table
// whose primary key IS the code, so two requests racing on one code produce exactly one row.
//
// A `SELECT ... then INSERT if absent` would look equivalent and would not be: two requests
// can both read "not redeemed" before either writes. The insert is the check.
import type { Database } from '../../platform/db.ts';
import { phoneSearchVariants } from '../../domain/phone.ts';
import type { Amount, OrderQuery, RedeemOutcome, Redemption } from '../../db/types.ts';

export interface RedemptionQueries {
    redeemCode(code: string, wallet: string, network: string): Promise<RedeemOutcome>;
    markRedemptionNotified(code: string): Promise<void>;
    unnotifiedRedemptions(): Promise<number>;
    searchRedemptions(query: OrderQuery): Promise<{ rows: Redemption[]; total: number }>;
}

interface RedemptionRow {
    code: string;
    amount: number;
    wallet: string;
    network: string;
    phone: string;
    notified: boolean;
    claimed_at: string;
}

function toRedemption(row: RedemptionRow): Redemption {
    return {
        code: row.code,
        amount: row.amount as Amount,
        wallet: row.wallet,
        network: row.network,
        phone: row.phone,
        notified: row.notified,
        claimedAt: row.claimed_at
    };
}

// WHAT COUNTS AS A REAL CODE: one this shop loaded AND actually sold. The join to a paid
// order is what draws that line - a `free` row is stock the shop still owns and a `held`
// one is a checkout in flight, and paying out against either would be handing away
// inventory to whoever guessed at it.
const FIND_SOLD = `
    SELECT c.amount AS amount, o.phone AS phone
    FROM codes c JOIN orders o ON o.code = c.code
    WHERE c.code = $1 AND o.status = 'paid'
    LIMIT 1`;

// ON CONFLICT DO NOTHING, not a plain INSERT: hitting the primary key is the table refusing a
// second spend, which is an answer rather than a crash. The count of rows written is how that
// answer is read. A request racing another on the same code waits here for the first to commit,
// then finds its row.
const INSERT_REDEMPTION = `
    INSERT INTO redemptions (code, amount, wallet, network, phone, notified, claimed_at)
    VALUES ($1, $2, $3, $4, $5, FALSE, $6)
    ON CONFLICT (code) DO NOTHING`;

// One box, as on the ledger: part of the code, the address, or the buyer's number. An empty
// term matches every row. The ones nobody was told about come first - each is a person
// waiting on a transfer the operator may not know is owed.
const MATCHING = `
    FROM redemptions
    WHERE $1 = '' OR code LIKE $2 OR lower(wallet) LIKE $2 OR phone LIKE $3 OR phone LIKE $4`;

export function createRedemptionQueries(db: Database): RedemptionQueries {
    return {
        async redeemCode(code, wallet, network) {
            return db.transaction(async (tx): Promise<RedeemOutcome> => {
                const sold = await tx.row<{ amount: number; phone: string }>(FIND_SOLD, [code]);
                if (sold === undefined) {
                    return { state: 'unknown' };
                }

                const claimedAt = new Date().toISOString();
                const written = await tx.run(INSERT_REDEMPTION, [
                    code,
                    sold.amount,
                    wallet,
                    network,
                    sold.phone,
                    claimedAt
                ]);

                if (written !== 1) {
                    // Already spent. The existing row's timestamp is read back rather than
                    // guessed at, because it is what the holder is told - and "you redeemed
                    // this on the 3rd" is the difference between a clear refusal and an
                    // accusation.
                    const existing = await tx.row<{ claimed_at: string }>(
                        'SELECT claimed_at FROM redemptions WHERE code = $1',
                        [code]
                    );
                    return { state: 'spent', at: existing?.claimed_at ?? '' };
                }

                return {
                    state: 'claimed',
                    redemption: {
                        code,
                        amount: sold.amount as Amount,
                        wallet,
                        network,
                        phone: sold.phone,
                        notified: false,
                        claimedAt
                    }
                };
            });
        },

        async markRedemptionNotified(code) {
            await db.run('UPDATE redemptions SET notified = TRUE WHERE code = $1', [code]);
        },

        async unnotifiedRedemptions() {
            const row = await db.row<{ n: number }>(
                'SELECT COUNT(*) AS n FROM redemptions WHERE NOT notified'
            );
            return row?.n ?? 0;
        },

        async searchRedemptions(query) {
            const term = query.search.trim();
            const like = `%${term.toLowerCase()}%`;
            const phoneLike = phoneSearchVariants(term).map((variant) => `%${variant}%`);
            const bind = [term, like, phoneLike[0] ?? like, phoneLike[1] ?? like];
            const rows = await db.rows<RedemptionRow>(
                `SELECT code, amount, wallet, network, phone, notified, claimed_at ${MATCHING}
                 ORDER BY notified ASC, claimed_at DESC
                 LIMIT $5 OFFSET $6`,
                [...bind, query.limit, query.offset]
            );
            const counted = await db.row<{ n: number }>(`SELECT COUNT(*) AS n ${MATCHING}`, bind);
            return { rows: rows.map(toRedemption), total: counted?.n ?? 0 };
        }
    };
}
