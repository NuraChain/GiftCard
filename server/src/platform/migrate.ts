// Changes to tables that already exist, which `CREATE TABLE IF NOT EXISTS` cannot make.
//
// schema.ts said this file would arrive the day something had to be ALTERed rather than
// created. That day is the move from delivering codes by SMS to delivering them by email:
// `orders.phone` holds the buyer's contact and had to become `orders.email`, and a shop that
// has already sold something cannot simply be handed a new schema.
//
// WHY THERE IS NO VERSION NUMBER. The usual runner keeps a counter and trusts it. A counter
// can be wrong - restored from a backup taken mid-deploy, copied between environments, edited
// by someone in a hurry - and when it is wrong the runner either skips a migration that was
// needed or repeats one that was not. Every migration here instead asks the DATABASE what
// shape it is in and acts on the answer, so running it twice is a no-op by construction and
// running it against any starting state does the right thing. That is worth more than an
// ordering guarantee for a list this size.
import type { Database } from './db.ts';

interface Migration {
    /** What it does, in the words that would explain it in a log line. */
    name: string;

    /** True when the database is in the state this migration exists to change. */
    needed(db: Database): boolean;

    run(db: Database): void;
}

/** @internal The column names of a table, straight from SQLite. */
function columns(db: Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
}

const MIGRATIONS: Migration[] = [
    {
        // Codes used to be texted to a mobile number; they are emailed now. The column is
        // RENAMED rather than added-and-copied so the ledger keeps pointing at the same
        // values - every historical order still shows the contact it was delivered to, which
        // is the whole reason the row is kept.
        name: 'orders.phone -> orders.email',
        needed: (db) => {
            const has = columns(db, 'orders');
            return has.has('phone') && !has.has('email');
        },
        run: (db) => db.exec('ALTER TABLE orders RENAME COLUMN phone TO email')
    },
    {
        name: 'orders.sms_delivered -> orders.mail_delivered',
        needed: (db) => {
            const has = columns(db, 'orders');
            return has.has('sms_delivered') && !has.has('mail_delivered');
        },
        run: (db) => db.exec('ALTER TABLE orders RENAME COLUMN sms_delivered TO mail_delivered')
    }
];

/**
 * Brings an existing database up to the shape schema.ts describes.
 *
 * Runs AFTER the schema, because a fresh database has to have its tables before anything can
 * ask about their columns - and on a fresh database every migration here finds nothing to do,
 * which is exactly right.
 *
 * Returns the names of the migrations that actually ran, so the caller can log them. A silent
 * migration is how a schema change becomes a mystery six months later.
 */
export function migrate(db: Database): string[] {
    const applied: string[] = [];
    for (const migration of MIGRATIONS) {
        if (migration.needed(db)) {
            migration.run(db);
            applied.push(migration.name);
        }
    }
    return applied;
}
