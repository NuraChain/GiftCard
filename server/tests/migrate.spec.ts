// The migration that renamed the buyer's contact column, tested against the old shape.
//
// A migration is the one piece of code that runs exactly once, on a database nobody can
// replace, usually at a moment when everybody is busy. So it is tested from BOTH starting
// states: a database that still has the old columns, and one that already has the new ones.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { migrate } from '../src/platform/migrate.ts';
import { SCHEMA } from '../src/platform/schema.ts';

/** Orders and redemptions as they existed while email delivery was active. */
const EMAIL_ORDERS = `
CREATE TABLE orders (
    id            TEXT    PRIMARY KEY,
    authority     TEXT    UNIQUE,
    amount        INTEGER NOT NULL,
    toman         INTEGER NOT NULL,
    email         TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    code          TEXT,
    ref_id        INTEGER,
    mail_delivered INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    settled_at    TEXT
);`;

const EMAIL_REDEMPTIONS = `
CREATE TABLE redemptions (
    code TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    network TEXT NOT NULL,
    email TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0,
    claimed_at TEXT NOT NULL
);`;

function columns(db: DatabaseSync, table = 'orders'): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
}

describe('the schema migration', () => {
    it('renames the contact columns back to mobile while preserving order history', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(EMAIL_ORDERS);
        db.exec(EMAIL_REDEMPTIONS);
        db.exec(
            'INSERT INTO orders (id, amount, toman, email, status, mail_delivered, created_at)' +
                " VALUES ('o1', 10, 1000, 'buyer@example.com', 'paid', 1, '2026-01-01')"
        );
        db.exec(
            "INSERT INTO redemptions VALUES ('c1', 10, 'wallet', 'TRC20', 'buyer@example.com', 0, '2026-01-01')"
        );
        db.exec(SCHEMA);

        const applied = migrate(db);

        // The three renames, and the `lang` column every order before the English shop lacks.
        expect(applied).toHaveLength(4);
        expect(applied).toContain('orders.lang');
        expect(columns(db).has('phone')).toBe(true);
        expect(columns(db).has('email')).toBe(false);
        expect(columns(db).has('sms_delivered')).toBe(true);
        expect(columns(db, 'redemptions').has('phone')).toBe(true);

        const row = db.prepare('SELECT phone, sms_delivered FROM orders').get() as {
            phone: string;
            sms_delivered: number;
        };
        expect(row.phone).toBe('buyer@example.com');
        expect(row.sms_delivered).toBe(1);
        const redemption = db.prepare('SELECT phone FROM redemptions').get() as { phone: string };
        expect(redemption.phone).toBe('buyer@example.com');
        db.close();
    });

    it('does nothing to a database that is already the right shape', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(SCHEMA);

        // A fresh database arrives correct, so every migration must find nothing to do -
        // otherwise a first boot would be doing schema surgery for no reason.
        expect(migrate(db)).toEqual([]);
        expect(columns(db).has('phone')).toBe(true);
        db.close();
    });

    it('is safe to run twice', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(EMAIL_ORDERS);
        db.exec(EMAIL_REDEMPTIONS);
        db.exec(SCHEMA);

        expect(migrate(db)).toHaveLength(4);
        // Idempotent BY CONSTRUCTION: each migration asks the database what shape it is in
        // rather than trusting a stored version number that a restore can make wrong.
        expect(migrate(db)).toEqual([]);
        db.close();
    });

    it('marks every order from before the English shop as Persian', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(EMAIL_ORDERS);
        db.exec(
            'INSERT INTO orders (id, amount, toman, email, status, mail_delivered, created_at)' +
                " VALUES ('o1', 10, 1000, 'buyer@example.com', 'paid', 1, '2026-01-01')"
        );
        db.exec(SCHEMA);
        migrate(db);

        expect(db.prepare('SELECT lang FROM orders').get()).toEqual({ lang: 'fa' });
        db.close();
    });

    it('adds the English copy columns to an existing catalogue', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE tiers (
            amount INTEGER PRIMARY KEY, toman INTEGER NOT NULL, title TEXT NOT NULL,
            blurb TEXT NOT NULL, recommended INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
        )`);
        db.exec("INSERT INTO tiers (amount, toman, title, blurb) VALUES (10, 0, 't', 'b')");
        db.exec(SCHEMA);

        expect(migrate(db)).toContain('tiers.title_en, tiers.blurb_en');
        expect(db.prepare('SELECT title_en, blurb_en FROM tiers').get()).toEqual({
            title_en: '',
            blurb_en: ''
        });
        db.close();
    });

    it('leaves the Resend settings alone now that the English shop emails codes', () => {
        // A migration that used to delete these ran on every boot. It must not come back:
        // it would wipe the credentials an operator had just saved.
        const db = new DatabaseSync(':memory:');
        db.exec(SCHEMA);
        db.exec(
            "INSERT INTO settings (key, value) VALUES ('resendApiKey', 're_secret'), ('mailFrom', 'shop@example.test')"
        );

        migrate(db);

        expect(
            db
                .prepare(
                    "SELECT COUNT(*) AS count FROM settings WHERE key IN ('resendApiKey', 'mailFrom')"
                )
                .get()
        ).toEqual({ count: 2 });
        db.close();
    });
});
