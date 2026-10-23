// Spending a gift code, and the single statement that makes it unrepeatable.
//
// THE ONE THING THIS MODULE GUARANTEES: a code pays out once. It is the same guarantee
// features/inventory/queries.ts makes about handing a code to a buyer, and it is kept the
// same way - by letting the DATABASE decide the winner rather than application timing. There
// `claim` is an UPDATE whose subquery picks a free row; here it is an INSERT against a table
// whose primary key IS the code, so two requests racing on one code produce exactly one row.
//
// A `SELECT ... then INSERT if absent` would look equivalent and would not be: two requests
// can both read "not redeemed" before either writes. The insert is the check.
import type { DatabaseSync } from 'node:sqlite';

import { shaped } from '../../platform/db.ts';
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
    notified: number;
    claimed_at: string;
}

function toRedemption(row: RedemptionRow): Redemption {
    return {
        code: row.code,
        amount: row.amount as Amount,
        wallet: row.wallet,
        network: row.network,
        phone: row.phone,
        notified: row.notified === 1,
        claimedAt: row.claimed_at
    };
}

export function createRedemptionQueries(db: DatabaseSync): RedemptionQueries {
    // WHAT COUNTS AS A REAL CODE: one this shop loaded AND actually sold. The join to a paid
    // order is what draws that line - a `free` row is stock the shop still owns and a `held`
    // one is a checkout in flight, and paying out against either would be handing away
    // inventory to whoever guessed at it.
    const findSold = db.prepare(`
        SELECT c.amount AS amount, o.phone AS phone
        FROM codes c JOIN orders o ON o.code = c.code
        WHERE c.code = ? AND o.status = 'paid'
        LIMIT 1`);

    // OR IGNORE, not a plain INSERT: hitting the primary key is the table refusing a second
    // spend, which is an answer rather than a crash. `changes` is how that answer is read.
    const insertRedemption = db.prepare(`
        INSERT OR IGNORE INTO redemptions (code, amount, wallet, network, phone, notified, claimed_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)`);
    const selectRedemption = db.prepare('SELECT claimed_at FROM redemptions WHERE code = ?');
    const setNotified = db.prepare('UPDATE redemptions SET notified = 1 WHERE code = ?');
    const countUnnotified = db.prepare('SELECT COUNT(*) AS n FROM redemptions WHERE notified = 0');

    // One box, as on the ledger: part of the code, the address, or the buyer's number. An
    // empty term matches every row. The ones nobody was told about come first - each is a
    // person waiting on a transfer the operator may not know is owed.
    const matching = `
        FROM redemptions
        WHERE ? = '' OR code LIKE ? OR lower(wallet) LIKE ? OR phone LIKE ? OR phone LIKE ?`;
    const searchPage = db.prepare(`
        SELECT code, amount, wallet, network, phone, notified, claimed_at ${matching}
        ORDER BY notified ASC, claimed_at DESC
        LIMIT ? OFFSET ?`);
    const searchCount = db.prepare(`SELECT COUNT(*) AS n ${matching}`);

    return {
        async redeemCode(code, wallet, network) {
            // IMMEDIATE takes the write lock up front. The lookup and the insert are one act:
            // without it a second connection can commit between them and this transaction
            // discovers it cannot upgrade, which SQLite reports as a busy error rather than
            // as the refusal it actually is.
            db.exec('BEGIN IMMEDIATE');
            try {
                const sold = shaped<{ amount: number; phone: string } | undefined>(
                    findSold.get(code)
                );
                if (sold === undefined) {
                    db.exec('ROLLBACK');
                    return { state: 'unknown' };
                }

                const claimedAt = new Date().toISOString();
                const changes = insertRedemption.run(
                    code,
                    sold.amount,
                    wallet,
                    network,
                    sold.phone,
                    claimedAt
                ).changes;

                if (changes !== 1) {
                    // Already spent. The existing row's timestamp is read back rather than
                    // guessed at, because it is what the holder is told - and "you redeemed
                    // this on the 3rd" is the difference between a clear refusal and an
                    // accusation.
                    const existing = shaped<{ claimed_at: string } | undefined>(
                        selectRedemption.get(code)
                    );
                    db.exec('ROLLBACK');
                    return { state: 'spent', at: existing?.claimed_at ?? '' };
                }

                db.exec('COMMIT');
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
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        async markRedemptionNotified(code) {
            setNotified.run(code);
        },

        async unnotifiedRedemptions() {
            return shaped<{ n: number }>(countUnnotified.get()).n;
        },

        async searchRedemptions(query) {
            const term = query.search.trim();
            const like = `%${term.toLowerCase()}%`;
            const phoneLike = phoneSearchVariants(term).map((variant) => `%${variant}%`);
            const bind = [term, like, like, phoneLike[0] ?? like, phoneLike[1] ?? like];
            return {
                rows: shaped<RedemptionRow[]>(
                    searchPage.all(...bind, query.limit, query.offset)
                ).map(toRedemption),
                total: shaped<{ n: number }>(searchCount.get(...bind)).n
            };
        }
    };
}
