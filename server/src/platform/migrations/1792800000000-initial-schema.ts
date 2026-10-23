import type { MigrationInterface, QueryRunner } from 'typeorm';

// The shop's first schema, written as the PostgreSQL it is rather than generated: TypeORM cannot
// declare a partial index or a DESC key. Table names are bare - every connection's search_path is
// the shop's own schema (see ../db.ts).
//
// Money and identity are BIGINT wherever they can outgrow four bytes: a Toman price, a gateway's
// reference, a hold's millisecond deadline. The times the shop shows are TEXT, ISO-8601 in UTC as
// the code writes them - fixed width, so they sort the way they read.
//
// There are no foreign keys, on purpose: codes and orders are joined by application logic, so a
// deleted order can never take a code that is still worth money down with it.
export class InitialSchema1792800000000 implements MigrationInterface {
    public readonly name = 'InitialSchema1792800000000';

    public async up(runner: QueryRunner): Promise<void> {
        await runner.query(`
            CREATE TABLE codes (
                id         BIGSERIAL PRIMARY KEY,
                amount     INTEGER NOT NULL,
                code       TEXT    NOT NULL,
                order_id   TEXT,
                hold_until BIGINT,
                added_at   TEXT    NOT NULL
            );
            CREATE UNIQUE INDEX codes_code ON codes (code);

            -- What a checkout claims from: the free codes of one denomination, oldest first.
            CREATE INDEX codes_free ON codes (amount, id) WHERE order_id IS NULL;

            -- Keeping, releasing and finding the code an order holds.
            CREATE INDEX codes_by_order ON codes (order_id);

            -- The sweep runs on every stock read and every purchase; this keeps it proportional
            -- to the holds in flight rather than to the whole inventory.
            CREATE INDEX codes_held ON codes (hold_until);

            -- lang is which shop the buyer was in, and it decides three things: the gateway
            -- (Zarinpal or Zibal for 'fa', NOWPayments for 'en'), whether toman or amount is the
            -- sum charged, and whether the code goes out by SMS or by email. phone holds the
            -- buyer's EMAIL on an 'en' order.
            CREATE TABLE orders (
                id            TEXT    PRIMARY KEY,
                authority     TEXT,
                amount        INTEGER NOT NULL,
                toman         BIGINT  NOT NULL,
                phone         TEXT    NOT NULL,
                status        TEXT    NOT NULL,
                code          TEXT,
                ref_id        BIGINT,
                sms_delivered BOOLEAN NOT NULL,
                created_at    TEXT    NOT NULL,
                settled_at    TEXT,
                lang          TEXT    NOT NULL
            );

            -- One gateway handle, one order, always. Unbound orders are NULL, and NULLs never
            -- collide.
            CREATE UNIQUE INDEX orders_by_authority ON orders (authority);
            CREATE INDEX orders_recent ON orders (created_at DESC);

            -- The inventory view joins codes to the order that took them ON THE CODE, so without
            -- this every code row scans the whole ledger. It is the difference between a console
            -- that stays usable at ten thousand orders and one that does not.
            CREATE INDEX orders_by_code ON orders (code);

            -- The owed count and the ledger's pinned ordering both ask "paid, and no code yet".
            CREATE INDEX orders_owed ON orders (status, code);

            -- The payments NOWPayments has made under an invoice, by the order's stored handle.
            -- An invoice is the page; a payment is what the buyer sends once they pick a coin,
            -- and with nothing but the API key only a payment can be read back - so its id is
            -- kept here once NOWPayments has confirmed it belongs to the invoice
            -- (features/checkout/nowpayments.ts, rule 2). A table, not a column: one invoice can
            -- carry several payments. The id only orders them, oldest first.
            CREATE TABLE gateway_payments (
                id         BIGSERIAL PRIMARY KEY,
                authority  TEXT NOT NULL,
                payment_id TEXT NOT NULL
            );
            CREATE UNIQUE INDEX gateway_payments_pair ON gateway_payments (authority, payment_id);

            -- WHAT MAKES A REDEEMED CODE SPENT. One row per code, and code is the PRIMARY KEY -
            -- so two requests racing on the same code are decided by the database rather than by
            -- application timing, exactly the way codes_free decides which buyer gets which code.
            -- An INSERT that changes nothing means somebody already redeemed it, and the caller
            -- must refuse.
            --
            -- IT IS A SEPARATE TABLE RATHER THAN A COLUMN ON codes for one reason: this is a
            -- PAYOUT REQUEST, not a state flag. It has to say where the money was asked to go and
            -- on which network, and it has to survive the code row it points at - a restore, a
            -- re-import, an operator clearing old stock. A boolean could not be audited against a
            -- transfer.
            CREATE TABLE redemptions (
                code       TEXT    PRIMARY KEY,
                amount     INTEGER NOT NULL,
                wallet     TEXT    NOT NULL,
                network    TEXT    NOT NULL,
                phone      TEXT    NOT NULL,
                notified   BOOLEAN NOT NULL,
                claimed_at TEXT    NOT NULL
            );

            -- "Which payouts has nobody been told about" is asked on every /status, and a
            -- redemption the operator never saw is somebody waiting on money that is not coming.
            -- The second key is the order the console lists them in.
            CREATE INDEX redemptions_pending ON redemptions (notified, claimed_at DESC);

            CREATE TABLE settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- One admin means "who" is noise; "when" and "what" are not. Values here are MASKED,
            -- so the log cannot become a second copy of the credentials.
            CREATE TABLE settings_log (
                id         BIGSERIAL PRIMARY KEY,
                key        TEXT NOT NULL,
                before     TEXT NOT NULL,
                after      TEXT NOT NULL,
                changed_at TEXT NOT NULL
            );

            CREATE TABLE tiers (
                amount      INTEGER PRIMARY KEY,
                title       TEXT    NOT NULL,
                blurb       TEXT    NOT NULL,
                title_en    TEXT    NOT NULL,
                blurb_en    TEXT    NOT NULL,
                recommended BOOLEAN NOT NULL,
                active      BOOLEAN NOT NULL,
                sort        INTEGER NOT NULL
            );
        `);
    }

    public async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            'DROP TABLE tiers, settings_log, settings, redemptions, gateway_payments, orders, codes'
        );
    }
}
