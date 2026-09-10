// The catalogue: what the shop sells, and at what price.
//
// The rule that lives here rather than in a route: a tier with codes or orders behind it is
// DEACTIVATED rather than deleted, because dropping the row would orphan the history that
// explains what someone paid.
import type { DatabaseSync } from 'node:sqlite';

import { shaped } from '../../platform/db.ts';
import type { Amount, Tier, TierInput, TierRemoval } from '../../db/types.ts';

/** The row shape SQLite returns; booleans are integers. */
interface TierRow {
    amount: number;
    toman: number;
    title: string;
    blurb: string;
    recommended: number;
    active: number;
    sort: number;
}

function toTier(row: TierRow): Tier {
    return {
        amount: row.amount,
        toman: row.toman,
        title: row.title,
        blurb: row.blurb,
        recommended: row.recommended === 1,
        active: row.active === 1,
        sort: row.sort
    };
}

export interface TierQueries {
    tiers(): Tier[];
    sellableTier(amount: Amount): Tier | undefined;
    saveTier(tier: TierInput): void;
    removeTier(amount: Amount): TierRemoval;
    isCatalogueEmpty(): boolean;
}

export function createTierQueries(db: DatabaseSync): TierQueries {
    const selectTiers = db.prepare('SELECT * FROM tiers ORDER BY sort, amount');
    const selectSellable = db.prepare('SELECT * FROM tiers WHERE amount = ? AND active = 1');
    const upsertTier = db.prepare(`
        INSERT INTO tiers (amount, toman, title, blurb, recommended, active, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(amount) DO UPDATE SET
            toman = excluded.toman, title = excluded.title, blurb = excluded.blurb,
            recommended = excluded.recommended, active = excluded.active,
            sort = excluded.sort`);
    // At most one recommended card: the treatment means "most people pick this", and two of
    // them means nothing. Clearing the others is cheaper than validating the whole table.
    const clearRecommended = db.prepare('UPDATE tiers SET recommended = 0 WHERE amount <> ?');
    const deleteTier = db.prepare('DELETE FROM tiers WHERE amount = ?');
    const deactivateTier = db.prepare('UPDATE tiers SET active = 0 WHERE amount = ?');
    const tierIsUsed = db.prepare(`
        SELECT EXISTS(SELECT 1 FROM codes WHERE amount = ?)
            OR EXISTS(SELECT 1 FROM orders WHERE amount = ?) AS used`);
    const countTiers = db.prepare('SELECT COUNT(*) AS n FROM tiers');

    return {
        tiers() {
            return shaped<TierRow[]>(selectTiers.all()).map(toTier);
        },

        sellableTier(amount) {
            const row = shaped<TierRow | undefined>(selectSellable.get(amount));
            return row === undefined ? undefined : toTier(row);
        },

        saveTier(tier) {
            db.exec('BEGIN IMMEDIATE');
            try {
                upsertTier.run(
                    tier.amount,
                    tier.toman,
                    tier.title,
                    tier.blurb,
                    tier.recommended ? 1 : 0,
                    tier.active ? 1 : 0,
                    tier.sort
                );
                if (tier.recommended) {
                    clearRecommended.run(tier.amount);
                }
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        removeTier(amount) {
            db.exec('BEGIN IMMEDIATE');
            try {
                let outcome: TierRemoval;
                if (shaped<{ used: number }>(tierIsUsed.get(amount, amount)).used === 1) {
                    // Codes or orders carry this amount. Dropping the row would orphan the
                    // history that explains what someone paid, so it is only hidden.
                    outcome = deactivateTier.run(amount).changes === 1 ? 'deactivated' : 'missing';
                } else {
                    outcome = deleteTier.run(amount).changes === 1 ? 'deleted' : 'missing';
                }
                db.exec('COMMIT');
                return outcome;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        isCatalogueEmpty() {
            return shaped<{ n: number }>(countTiers.get()).n === 0;
        }
    };
}
