// Opening the database, and composing the four query modules into one Store.
//
// `:memory:` gives tests the REAL engine rather than a fake, so the claim semantics under
// test are the ones that ship.
import { DatabaseSync } from 'node:sqlite';

import { createCodeQueries } from './codes.ts';
import { createOrderQueries } from './orders.ts';
import { SCHEMA } from './schema.ts';
import { createSettingQueries } from './settings.ts';
import { createTierQueries } from './tiers.ts';
import type { Store } from './types.ts';

export function createStore(file: string): Store
{
    const db = new DatabaseSync(file);
    // WAL lets a reader (the shop counting stock) run while a writer (a purchase) commits.
    // A foreign-key pragma is not needed - codes and orders are joined by application logic
    // on purpose, so a deleted order can never orphan a code that is still worth money.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SCHEMA);

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
