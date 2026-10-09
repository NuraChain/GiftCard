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

        expect(applied).toHaveLength(3);
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

        expect(migrate(db)).toHaveLength(3);
        // Idempotent BY CONSTRUCTION: each migration asks the database what shape it is in
        // rather than trusting a stored version number that a restore can make wrong.
        expect(migrate(db)).toEqual([]);
        db.close();
    });

    it('removes obsolete Resend credentials from settings and their audit rows', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(SCHEMA);
        db.exec(
            "INSERT INTO settings (key, value) VALUES ('resendApiKey', 'old-secret'), ('mailFrom', 'shop@example.test'), ('resendBase', 'https://mail.example.test')"
        );
        db.exec(
            "INSERT INTO settings_log (key, before, after, changed_at) VALUES ('resendApiKey', '••••', '••••', '2026-01-01')"
        );

        expect(migrate(db)).toContain('remove obsolete email delivery settings');
        expect(
            db
                .prepare(
                    "SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'resend%' OR key = 'mailFrom'"
                )
                .get()
        ).toEqual({ count: 0 });
        expect(
            db
                .prepare("SELECT COUNT(*) AS count FROM settings_log WHERE key = 'resendApiKey'")
                .get()
        ).toEqual({ count: 0 });
        db.close();
    });
});
