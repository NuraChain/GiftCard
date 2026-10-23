// The catalogue: what the shop sells. NOT at what price - see domain/pricing.ts for that.
//
// The rule that lives here rather than in a route: a tier with codes or orders behind it is
// DEACTIVATED rather than deleted, because dropping the row would orphan the history that
// explains what someone paid.
import type { Database, Sql } from '../../platform/db.ts';
import type { Amount, Tier, TierInput, TierRemoval } from '../../db/types.ts';

/** A tier as it comes off the table. */
interface TierRow {
    amount: number;
    title: string;
    blurb: string;
    title_en: string;
    blurb_en: string;
    recommended: boolean;
    active: boolean;
    sort: number;
}

function toTier(row: TierRow): Tier {
    return {
        amount: row.amount,
        title: row.title,
        blurb: row.blurb,
        titleEn: row.title_en,
        blurbEn: row.blurb_en,
        recommended: row.recommended,
        active: row.active,
        sort: row.sort
    };
}

export interface TierQueries {
    tiers(): Promise<Tier[]>;
    sellableTier(amount: Amount): Promise<Tier | undefined>;
    saveTier(tier: TierInput): Promise<void>;
    removeTier(amount: Amount): Promise<TierRemoval>;
    isCatalogueEmpty(): Promise<boolean>;
}

/**
 * One edit of the catalogue at a time. Saving a recommended card clears the flag on every
 * other row, so two saves at once would each lock rows the other is about to touch; readers
 * are never held up by this.
 */
async function editingCatalogue(tx: Sql): Promise<void> {
    await tx.run('LOCK TABLE tiers IN SHARE ROW EXCLUSIVE MODE');
}

export function createTierQueries(db: Database): TierQueries {
    return {
        async tiers() {
            const rows = await db.rows<TierRow>('SELECT * FROM tiers ORDER BY sort, amount');
            return rows.map(toTier);
        },

        async sellableTier(amount) {
            const row = await db.row<TierRow>('SELECT * FROM tiers WHERE amount = $1 AND active', [
                amount
            ]);
            return row === undefined ? undefined : toTier(row);
        },

        async saveTier(tier) {
            await db.transaction(async (tx) => {
                await editingCatalogue(tx);
                await tx.run(
                    `INSERT INTO tiers (amount, title, blurb, title_en, blurb_en, recommended, active, sort)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (amount) DO UPDATE SET
                         title = EXCLUDED.title, blurb = EXCLUDED.blurb,
                         title_en = EXCLUDED.title_en, blurb_en = EXCLUDED.blurb_en,
                         recommended = EXCLUDED.recommended, active = EXCLUDED.active,
                         sort = EXCLUDED.sort`,
                    [
                        tier.amount,
                        tier.title,
                        tier.blurb,
                        tier.titleEn,
                        tier.blurbEn,
                        tier.recommended,
                        tier.active,
                        tier.sort
                    ]
                );
                // At most one recommended card: the treatment means "most people pick this",
                // and two of them means nothing. Clearing the others is cheaper than
                // validating the whole table.
                if (tier.recommended) {
                    await tx.run('UPDATE tiers SET recommended = FALSE WHERE amount <> $1', [
                        tier.amount
                    ]);
                }
            });
        },

        async removeTier(amount) {
            return db.transaction(async (tx): Promise<TierRemoval> => {
                await editingCatalogue(tx);
                const usage = await tx.row<{ used: boolean }>(
                    `SELECT EXISTS (SELECT 1 FROM codes WHERE amount = $1)
                         OR EXISTS (SELECT 1 FROM orders WHERE amount = $1) AS used`,
                    [amount]
                );
                if (usage?.used === true) {
                    // Codes or orders carry this amount. Dropping the row would orphan the
                    // history that explains what someone paid, so it is only hidden.
                    const hidden = await tx.run(
                        'UPDATE tiers SET active = FALSE WHERE amount = $1',
                        [amount]
                    );
                    return hidden === 1 ? 'deactivated' : 'missing';
                }
                const deleted = await tx.run('DELETE FROM tiers WHERE amount = $1', [amount]);
                return deleted === 1 ? 'deleted' : 'missing';
            });
        },

        async isCatalogueEmpty() {
            const row = await db.row<{ populated: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM tiers) AS populated'
            );
            return row?.populated !== true;
        }
    };
}
