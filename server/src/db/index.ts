// Composing the four query modules into one Store.
//
// Opening the connection is platform/db.ts's job; this file only assembles. `:memory:`
// gives tests the REAL engine rather than a fake, so the claim semantics under test are
// the ones that ship.
import { openDatabase } from '../platform/db.ts';
import { createCodeQueries } from '../features/inventory/queries.ts';
import { createOrderQueries } from '../features/checkout/queries.ts';
import { createSettingQueries } from '../features/settings/queries.ts';
import { createTierQueries } from '../features/catalogue/queries.ts';
import type { Store } from './types.ts';

export function createStore(file: string, onMigrate?: (names: string[]) => void): Store {
    const db = openDatabase(file, onMigrate);

    const settings = createSettingQueries(db);
    const tiers = createTierQueries(db);
    const codes = createCodeQueries(db);
    const orders = createOrderQueries(db, codes);

    return {
        ...settings,
        ...tiers,
        ...codes,
        ...orders,

        // The stock strip is driven by the CATALOGUE rather than by whatever happens to be
        // in the codes table, so this is the one call that needs both modules.
        stock: () => codes.stock(tiers.tiers()),

        close: () => db.close()
    };
}

export * from './types.ts';
