// What the store promises that only a real PostgreSQL can show.
//
// The money paths are decided by the database's own locking, so they are tested the only way
// that means anything: many callers at once, each on a connection of its own, against the
// engine that ships. Beside them, the plumbing those promises stand on - a backup that
// restores, a schema built once, a schema TypeORM agrees with, a transaction nothing escapes.
import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { DataSource } from 'typeorm';

import { createStore, type NewOrder, type RedeemOutcome, type Store } from '../src/db/index.ts';
import { dataSourceOptions, openDatabase } from '../src/platform/db.ts';
import { inspect, openTestStore, schemaOf, testDatabase } from './support/database.ts';

const HOLD_MS = 15 * 60_000;

/** Enough connections for every racing caller below to be in the database at once. */
const RACERS = 8;

/**
 * A store whose pool already holds a connection per racer. A cold pool opens them one by one,
 * slowly enough that the first caller has committed before the second is connected - and a
 * race that never overlaps proves nothing.
 */
async function racingStore(): Promise<Store> {
    const store = await openTestStore({ poolSize: RACERS });
    await Promise.all(Array.from({ length: RACERS }, () => store.tiers()));
    return store;
}

let placed = 0;

function order(amount: number): NewOrder {
    placed += 1;
    return {
        id: `order-${placed}-${crypto.randomUUID()}`,
        amount,
        toman: amount * 100_000,
        phone: '09120000000',
        lang: 'fa',
        createdAt: new Date().toISOString()
    };
}

function uuids(length: number): string[] {
    return Array.from({ length }, () => crypto.randomUUID());
}

function claimedAt(outcome: RedeemOutcome | undefined): string {
    return outcome?.state === 'claimed' ? outcome.redemption.claimedAt : '';
}

/** Every session waiting, however indirectly, on the one with backend `pid`. */
const QUEUED_BEHIND = `
    WITH RECURSIVE queued (pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid))
        UNION
        SELECT waiting.pid FROM pg_stat_activity waiting
        JOIN queued ON queued.pid = ANY (pg_blocking_pids(waiting.pid))
    )
    SELECT count(*)::int AS n FROM queued`;

/**
 * Starts every one of `racers` while `orderId`'s row is held from outside the store, waits
 * until each of them is queued behind that hold, then lets them all go at once.
 *
 * Without it the first caller tends to finish inside the moment it takes the others to get a
 * statement in, and a race that never overlaps proves nothing. With it, wherever a racer
 * first touches the order's row - the start of a settlement, or its very last write - all of
 * them have done everything before that point concurrently.
 */
async function released<T>(
    store: Store,
    orderId: string,
    racers: Array<() => Promise<T>>
): Promise<T[]> {
    const gate = new pg.Client({ connectionString: testDatabase() });
    await gate.connect();
    try {
        await gate.query(`SET search_path TO "${schemaOf(store)}"`);
        await gate.query('BEGIN');
        await gate.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const { rows } = await gate.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const running = racers.map((racer) => racer());
        const deadline = Date.now() + 5_000;
        while (
            (await gate.query<{ n: number }>(QUEUED_BEHIND, [rows[0]?.pid])).rows[0]?.n !==
            racers.length
        ) {
            if (Date.now() > deadline) {
                throw new Error('the racers never all queued behind the held order');
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await gate.query('COMMIT');
        return await Promise.all(running);
    } finally {
        await gate.end();
    }
}

describe('the money paths, raced', () => {
    it('hands each free code to exactly one of many checkouts at once', async () => {
        const store = await racingStore();
        await store.addCodes(10, uuids(5));

        const started = await Promise.all(
            Array.from({ length: 12 }, () => store.startOrder(order(10), HOLD_MS))
        );

        expect(started.filter(Boolean)).toHaveLength(5);
        // Every winner holds a code of its own - none was handed to two of them - and the
        // checkouts that lost left no order behind.
        const held = await inspect<{ order_id: string }>(
            'SELECT order_id FROM codes WHERE order_id IS NOT NULL',
            schemaOf(store)
        );
        expect(new Set(held.map((row) => row.order_id)).size).toBe(5);
        expect(await inspect('SELECT id FROM orders', schemaOf(store))).toHaveLength(5);
        expect(await store.availableFor(10)).toBe(0);
    });

    it('settles a lapsed hold with one code, however many settlements arrive together', async () => {
        // The buyer took longer than the hold, so the code went back to stock before the
        // payment landed - the one path where a settlement claims a code of its own. Three of
        // them at once must still take ONE: the order's row queues the others behind the first.
        const store = await racingStore();
        await store.addCodes(10, uuids(3));
        const late = order(10);
        expect(await store.startOrder(late, -1)).toBe(true);
        expect(await store.availableFor(10)).toBe(3);

        const codes = await released(
            store,
            late.id,
            [1, 2, 3].map((refId) => () => store.settlePaid(late.id, refId))
        );

        expect(codes[0]).not.toBeNull();
        expect(new Set(codes).size).toBe(1);
        expect(await store.availableFor(10)).toBe(2);
        expect((await store.orderById(late.id))?.code).toBe(codes[0]);
    });

    it('pays a code out once when many redemptions of it arrive together', async () => {
        const store = await racingStore();
        await store.addCodes(10, uuids(1));
        const sold = order(10);
        await store.startOrder(sold, HOLD_MS);
        const code = await store.settlePaid(sold.id, 7);
        expect(code).not.toBeNull();

        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, at) =>
                store.redeemCode(code ?? '', `wallet-${at}`, 'TRC20')
            )
        );

        const claimed = outcomes.filter((outcome) => outcome.state === 'claimed');
        expect(claimed).toHaveLength(1);
        // Every refusal names the one spend that happened, not a time of its own.
        expect(outcomes.filter((outcome) => outcome.state === 'spent')).toEqual(
            Array.from({ length: 5 }, () => ({ state: 'spent', at: claimedAt(claimed[0]) }))
        );
    });

    it('binds one gateway handle to one order', async () => {
        const store = await openTestStore();
        await store.addCodes(10, uuids(2));
        const first = order(10);
        const second = order(10);
        await store.startOrder(first, HOLD_MS);
        await store.startOrder(second, HOLD_MS);

        expect(await store.attachAuthority(first.id, 'A0000000000000000000000000000000001')).toBe(
            true
        );
        // The unique index refusing, answered as the refusal it is.
        expect(await store.attachAuthority(second.id, 'A0000000000000000000000000000000001')).toBe(
            false
        );
        expect((await store.orderByAuthority('A0000000000000000000000000000000001'))?.id).toBe(
            first.id
        );
    });

    it('answers a key PostgreSQL could never have stored as a miss, not as an error', async () => {
        // A receipt link and a gateway redirect are both written by strangers.
        const store = await openTestStore();
        expect(await store.orderById('receipt\u0000')).toBeUndefined();
        expect(await store.orderByAuthority('\u0000')).toBeUndefined();
    });
});

describe('the dump the backup carries', () => {
    it('restores the whole shop, and restoring it twice changes nothing', async () => {
        const source = await openTestStore();
        // A quote and a backslash: the two characters a SQL literal can get wrong.
        await source.saveTier({
            amount: 10,
            title: "It's a \\ test",
            blurb: 'کارت ده دلاری',
            titleEn: '',
            blurbEn: '',
            recommended: true,
            active: true,
            sort: 1
        });
        await source.addCodes(10, uuids(2));
        const bought = order(10);
        await source.startOrder(bought, HOLD_MS);
        await source.attachAuthority(bought.id, 'nowpayments:4521');
        await source.rememberPayment('nowpayments:4521', '5745459419');
        // A reference past four bytes, as NOWPayments' payment ids are.
        const code = await source.settlePaid(bought.id, 5_745_459_419);
        await source.redeemCode(code ?? '', 'TXYZ', 'TRC20');
        await source.putSetting('appName', 'اشبرینگر');
        await source.logSetting({
            key: 'appName',
            before: '',
            after: 'اشبرینگر',
            changedAt: new Date().toISOString()
        });
        const sql = await source.dumpSql();

        const target = await openTestStore();
        await inspect(sql, schemaOf(target));
        await inspect(sql, schemaOf(target));

        const page = { search: '', limit: 10, offset: 0 };
        expect(await target.tiers()).toEqual(await source.tiers());
        expect(await target.orderById(bought.id)).toEqual(await source.orderById(bought.id));
        expect((await target.orderById(bought.id))?.refId).toBe(5_745_459_419);
        expect(await target.paymentsFor('nowpayments:4521')).toEqual(['5745459419']);
        expect(await target.stock()).toEqual(await source.stock());
        expect(await target.searchCodes({ ...page, state: null, amount: null })).toEqual(
            await source.searchCodes({ ...page, state: null, amount: null })
        );
        expect(await target.searchRedemptions(page)).toEqual(await source.searchRedemptions(page));
        expect(await target.allSettings()).toEqual(await source.allSettings());
        expect(await target.settingsLog(10)).toEqual(await source.settingsLog(10));

        // The sequences moved past the rows the dump brought back: what is written next lands
        // after them rather than colliding with one.
        expect((await target.addCodes(10, uuids(1))).added).toBe(1);
        await target.logSetting({ key: 'next', before: '', after: 'x', changedAt: '' });
        expect((await target.settingsLog(1))[0]?.key).toBe('next');
    });
});

describe('the schema', () => {
    it('is built once, and found already built the next time', async () => {
        const store = await openTestStore();
        const ran = await inspect<{ name: string }>(
            'SELECT name FROM migrations ORDER BY id',
            schemaOf(store)
        );
        expect(ran.map((row) => row.name)).toEqual(['InitialSchema1792800000000']);

        const migrated: string[] = [];
        const again = await createStore(
            { url: testDatabase(), schema: schemaOf(store), poolSize: 1 },
            (names) => migrated.push(...names)
        );
        await again.close();
        expect(migrated).toEqual([]);
    });

    it('describes to TypeORM exactly the tables the migration built', async () => {
        // The entities are TypeORM's picture of the schema and the migration is what made it.
        // If the two drift - a column renamed in one and not the other, a type that no longer
        // matches - TypeORM's own schema builder sees it, and this is where it says so.
        const store = await openTestStore();
        const source = new DataSource(
            dataSourceOptions({ url: testDatabase(), schema: schemaOf(store), poolSize: 1 })
        );
        await source.initialize();
        try {
            const pending = await source.driver.createSchemaBuilder().log();
            expect(pending.upQueries.map((query) => query.query)).toEqual([]);
        } finally {
            await source.destroy();
        }
    });
});

describe('a transaction', () => {
    it('commits whole or not at all, and refuses a statement that outlives it', async () => {
        const store = await openTestStore();
        const db = await openDatabase({
            url: testDatabase(),
            schema: schemaOf(store),
            poolSize: 1
        });
        try {
            await expect(
                db.transaction(async (tx) => {
                    await tx.run("INSERT INTO settings (key, value) VALUES ('half', 'done')");
                    throw new Error('gave up');
                })
            ).rejects.toThrow('gave up');
            expect(await db.rows('SELECT key FROM settings')).toEqual([]);

            // The handle itself, carried out of the transaction it belongs to.
            const escaped = await db.transaction((tx) => Promise.resolve(tx));
            await expect(escaped.rows('SELECT 1')).rejects.toThrow('outlived');
        } finally {
            await db.close();
        }
    });

    it('reads a snapshot and writes nothing through one', async () => {
        const store = await openTestStore();
        const db = await openDatabase({
            url: testDatabase(),
            schema: schemaOf(store),
            poolSize: 1
        });
        try {
            await expect(
                db.snapshot((tx) => tx.run("INSERT INTO settings (key, value) VALUES ('k', 'v')"))
            ).rejects.toThrow('read-only');
        } finally {
            await db.close();
        }
    });

    it('is refused once the store is closed', async () => {
        const store = await openTestStore();
        await store.close();
        await expect(store.tiers()).rejects.toThrow('closed');
    });
});
