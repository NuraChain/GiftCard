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
import type { Amount, RedeemOutcome } from '../../db/types.ts';

export interface RedemptionQueries {
    redeemCode(code: string, wallet: string, network: string): RedeemOutcome;
    markRedemptionNotified(code: string): void;
    unnotifiedRedemptions(): number;
}

export function createRedemptionQueries(db: DatabaseSync): RedemptionQueries {
    // WHAT COUNTS AS A REAL CODE: one this shop loaded AND actually sold. The join to a paid
    // order is what draws that line - a `free` row is stock the shop still owns and a `held`
    // one is a checkout in flight, and paying out against either would be handing away
    // inventory to whoever guessed at it.
    const findSold = db.prepare(`
        SELECT c.amount AS amount, o.email AS email
        FROM codes c JOIN orders o ON o.code = c.code
        WHERE c.code = ? AND o.status = 'paid'
        LIMIT 1`);

    // OR IGNORE, not a plain INSERT: hitting the primary key is the table refusing a second
    // spend, which is an answer rather than a crash. `changes` is how that answer is read.
    const insertRedemption = db.prepare(`
        INSERT OR IGNORE INTO redemptions (code, amount, wallet, network, email, notified, claimed_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)`);
    const selectRedemption = db.prepare('SELECT claimed_at FROM redemptions WHERE code = ?');
    const setNotified = db.prepare('UPDATE redemptions SET notified = 1 WHERE code = ?');
    const countUnnotified = db.prepare('SELECT COUNT(*) AS n FROM redemptions WHERE notified = 0');

    return {
        redeemCode(code, wallet, network) {
            // IMMEDIATE takes the write lock up front. The lookup and the insert are one act:
            // without it a second connection can commit between them and this transaction
            // discovers it cannot upgrade, which SQLite reports as a busy error rather than
            // as the refusal it actually is.
            db.exec('BEGIN IMMEDIATE');
            try {
                const sold = shaped<{ amount: number; email: string } | undefined>(
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
                    sold.email,
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
                        email: sold.email,
                        notified: false,
                        claimedAt
                    }
                };
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        markRedemptionNotified(code) {
            setNotified.run(code);
        },

        unnotifiedRedemptions() {
            return shaped<{ n: number }>(countUnnotified.get()).n;
        }
    };
}
