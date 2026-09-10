// The migration that renamed the buyer's contact column, tested against the old shape.
//
// A migration is the one piece of code that runs exactly once, on a database nobody can
// replace, usually at a moment when everybody is busy. So it is tested from BOTH starting
// states: a database that still has the old columns, and one that already has the new ones.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { migrate } from '../src/platform/migrate.ts';
import { SCHEMA } from '../src/platform/schema.ts';

/** The orders table exactly as it was before codes started being emailed. */
const OLD_ORDERS = `
CREATE TABLE orders (
    id            TEXT    PRIMARY KEY,
    authority     TEXT    UNIQUE,
    amount        INTEGER NOT NULL,
    toman         INTEGER NOT NULL,
    phone         TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    code          TEXT,
    ref_id        INTEGER,
    sms_delivered INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    settled_at    TEXT
);`;

function columns(db: DatabaseSync): Set<string> {
    const rows = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
}

describe('the schema migration', () => {
    it('renames the contact columns on a database that predates email', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(OLD_ORDERS);
        db.exec(
            'INSERT INTO orders (id, amount, toman, phone, status, sms_delivered, created_at)' +
                " VALUES ('o1', 10, 1000, '+989170459330', 'paid', 1, '2026-01-01')"
        );

        const applied = migrate(db);

        expect(applied).toHaveLength(2);
        expect(columns(db).has('email')).toBe(true);
        expect(columns(db).has('phone')).toBe(false);
        expect(columns(db).has('mail_delivered')).toBe(true);

        // RENAMED, not recreated: the history that explains what someone paid survives, and
        // it still names the contact the code was actually delivered to.
        const row = db.prepare('SELECT email, mail_delivered FROM orders').get() as {
            email: string;
            mail_delivered: number;
        };
        expect(row.email).toBe('+989170459330');
        expect(row.mail_delivered).toBe(1);
        db.close();
    });

    it('does nothing to a database that is already the right shape', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(SCHEMA);

        // A fresh database arrives correct, so every migration must find nothing to do -
        // otherwise a first boot would be doing schema surgery for no reason.
        expect(migrate(db)).toEqual([]);
        expect(columns(db).has('email')).toBe(true);
        db.close();
    });

    it('is safe to run twice', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(OLD_ORDERS);

        expect(migrate(db)).toHaveLength(2);
        // Idempotent BY CONSTRUCTION: each migration asks the database what shape it is in
        // rather than trusting a stored version number that a restore can make wrong.
        expect(migrate(db)).toEqual([]);
        db.close();
    });
});
