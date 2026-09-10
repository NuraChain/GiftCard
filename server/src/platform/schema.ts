// The whole database schema, in one readable place.
//
// `CREATE TABLE IF NOT EXISTS` is most of the migration story: this file runs on every boot,
// so adding a table or an index here is the whole deployment step. What it cannot do is ALTER
// a table that already exists - and that day came when codes stopped being texted and started
// being emailed. Those changes live in ./migrate.ts, which runs straight after this and is
// guarded on the shape the database is actually in.
//
// SO THIS FILE DESCRIBES THE DESTINATION, not the history. A fresh database gets exactly what
// is written below; an existing one is brought to the same shape by the migrations next door.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS codes (
    id         INTEGER PRIMARY KEY,
    amount     INTEGER NOT NULL,
    code       TEXT    NOT NULL UNIQUE,
    order_id   TEXT,
    hold_until INTEGER,
    added_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS codes_free ON codes (amount, order_id);

CREATE TABLE IF NOT EXISTS orders (
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
);
CREATE INDEX IF NOT EXISTS orders_recent ON orders (created_at DESC);

-- The inventory view joins codes to the order that took them ON THE CODE, so without this
-- every code row scans the whole ledger. It is the difference between a console that stays
-- usable at ten thousand orders and one that does not.
CREATE INDEX IF NOT EXISTS orders_by_code ON orders (code);

-- The owed count and the ledger's pinned ordering both ask "paid, and no code yet".
CREATE INDEX IF NOT EXISTS orders_owed ON orders (status, code);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One admin means "who" is noise; "when" and "what" are not. Values here are MASKED, so the
-- log cannot become a second copy of the credentials.
CREATE TABLE IF NOT EXISTS settings_log (
    id         INTEGER PRIMARY KEY,
    key        TEXT NOT NULL,
    before     TEXT NOT NULL,
    after      TEXT NOT NULL,
    changed_at TEXT NOT NULL
);

-- THE toman COLUMN IS DEAD. Card prices come from the live tether rate times a shop-wide margin
-- (domain/pricing.ts), so nothing reads this column and every insert writes a zero. It
-- survives because this runner cannot drop a column from an existing database and the rows
-- already out there hold real numbers. It goes with the first numbered migration.
CREATE TABLE IF NOT EXISTS tiers (
    amount      INTEGER PRIMARY KEY,
    toman       INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    blurb       TEXT    NOT NULL,
    recommended INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
);
`;
