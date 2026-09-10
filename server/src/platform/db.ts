// Opening the database, and the one cast every query module needs.
//
// This is the ONLY file that knows how a connection is made. A feature's query module
// receives the open handle and never opens one itself, which is what lets a test run the
// whole app against `:memory:` - the REAL engine rather than a fake, so the claim semantics
// under test are the ones that ship.
import { DatabaseSync } from 'node:sqlite';

import { migrate } from './migrate.ts';
import { SCHEMA } from './schema.ts';

/** The open handle a feature's query module is built on. */
export type Database = DatabaseSync;

/**
 * Opens `file`, sets the pragmas, applies the schema, then migrates.
 *
 * THAT ORDER MATTERS. The schema creates whatever is missing, so a fresh database arrives
 * already correct and every migration finds nothing to do; an existing one is untouched by
 * the schema and reshaped by the migrations. Either way what comes back matches schema.ts.
 *
 * WAL lets a reader (the shop counting stock) run while a writer (a purchase) commits.
 * A foreign-key pragma is deliberately absent: codes and orders are joined by application
 * logic on purpose, so a deleted order can never orphan a code that is still worth money.
 *
 * `onMigrate` is called with the names of any migrations that ran. A schema change nobody
 * logged is a mystery six months later.
 */
export function openDatabase(file: string, onMigrate?: (names: string[]) => void): Database {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SCHEMA);

    const applied = migrate(db);
    if (applied.length > 0) {
        onMigrate?.(applied);
    }
    return db;
}

/**
 * SQLite hands back loose `Record<string, SQLOutputValue>` rows. Every query selects known
 * columns from the schema next door, so the shape is asserted HERE rather than at each call
 * site - one place to look when a column is renamed.
 */
export function shaped<T>(row: unknown): T {
    return row as T;
}
