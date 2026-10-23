// Composing the five query modules into one Store.
//
// Opening the connection is platform/db.ts's job; this file only assembles.
import { openDatabase, type Connection } from '../platform/db.ts';
import { dumpSql } from '../platform/dump.ts';
import { createCodeQueries } from '../features/inventory/queries.ts';
import { createOrderQueries } from '../features/checkout/queries.ts';
import { createSettingQueries } from '../features/settings/queries.ts';
import { createTierQueries } from '../features/catalogue/queries.ts';
import { createRedemptionQueries } from '../features/redeem/queries.ts';
import type { Store } from './types.ts';

export async function createStore(
    connection: Connection,
    onMigrate?: (names: string[]) => void
): Promise<Store> {
    const db = await openDatabase(connection, onMigrate);

    const settings = createSettingQueries(db);
    const tiers = createTierQueries(db);
    const codes = createCodeQueries(db);
    const orders = createOrderQueries(db, codes);
    const redemptions = createRedemptionQueries(db);

    return {
        ...settings,
        ...tiers,
        ...codes,
        ...orders,
        ...redemptions,

        // The stock strip is driven by the CATALOGUE rather than by whatever happens to be
        // in the codes table, so this is the one call that needs both modules.
        stock: async () => codes.stock(await tiers.tiers()),

        dumpSql: () => dumpSql(db),
        close: () => db.close()
    };
}

export * from './types.ts';
