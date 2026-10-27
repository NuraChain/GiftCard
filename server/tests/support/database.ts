// The one place a test gets a store from: a schema of its own in a real PostgreSQL.
//
// The suite runs against PostgreSQL itself, through the same TypeORM and pg the server uses - a
// stand-in would agree with production only where somebody remembered to make it, and the claim
// and redemption guarantees are promises about this engine's locking. The database is
// TEST_DATABASE_URL, from the environment or from that one key of the root .env (see
// vitest.config.ts). Every store a test opens gets a schema nobody else will pick, so files run
// in parallel without seeing each other's rows, and `setup.ts` closes it and drops the schema
// after the test.
import pg from 'pg';

import { createStore, type Store } from '../../src/db/index.ts';

/** A schema this suite made: `t_<worker>_<process>_<n>`. Nothing else in the database matches. */
const TEST_SCHEMA = /^t_\d+_\d+_\d+$/;

const opened: Array<{ store: Store; schema: string }> = [];
let made = 0;

/** One connection per worker for making and dropping schemas; each store brings a pool of its own. */
let admin: pg.Pool | null = null;

/** The database the suite runs against. */
export function testDatabase(): string {
    const url = process.env.TEST_DATABASE_URL;
    if (url === undefined || url === '') {
        throw new Error(
            'TEST_DATABASE_URL is not set: the server suite needs a PostgreSQL database it may ' +
                'create schemas in - set it in the environment or in the root .env (see .env.example)'
        );
    }
    return url;
}

function adminPool(): pg.Pool {
    admin ??= new pg.Pool({ connectionString: testDatabase(), max: 1 });
    return admin;
}

/**
 * An empty, migrated store in a schema of its own, closed and dropped after the test.
 *
 * Two connections unless a test asks for more: one for a transaction and one for a read beside
 * it is all most tests need, and a worker that opened several must still fit the server's
 * limit. A test racing many callers at once asks for enough to let them actually overlap.
 */
export async function openTestStore(options: { poolSize?: number } = {}): Promise<Store> {
    made += 1;
    const schema = `t_${process.env.VITEST_POOL_ID ?? '0'}_${process.pid}_${made}`;
    await adminPool().query(`CREATE SCHEMA "${schema}"`);
    try {
        const store = await createStore({
            url: testDatabase(),
            schema,
            poolSize: options.poolSize ?? 2
        });
        opened.push({ store, schema });
        return store;
    } catch (error) {
        await adminPool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        throw error;
    }
}

/** The schema a store opened by this harness lives in. */
export function schemaOf(store: Store): string {
    const entry = opened.find((candidate) => candidate.store === store);
    if (entry === undefined) {
        throw new Error('not a store this harness opened');
    }
    return entry.schema;
}

/**
 * Runs `sql` against the test database with bare names resolving in `schema`, outside any
 * store - for restoring a dump into one, or looking at what one left behind.
 */
export async function inspect<T extends Record<string, unknown>>(
    sql: string,
    schema: string
): Promise<T[]> {
    const client = await adminPool().connect();
    try {
        await client.query(`SET search_path TO "${schema}"`);
        const result = await client.query<T>(sql);
        // A script of several statements answers one result per statement.
        return Array.isArray(result) ? [] : result.rows;
    } finally {
        await client.query('RESET search_path');
        client.release();
    }
}

/** Closes every store the test opened, and drops their schemas. */
export async function releaseTestStores(): Promise<void> {
    const closing = opened.splice(0, opened.length);
    await Promise.all(closing.map(({ store }) => store.close()));
    for (const { schema } of closing) {
        await adminPool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
}

/** Lets go of this worker's own connection, once its last test is done. */
export async function closeTestDatabase(): Promise<void> {
    await releaseTestStores();
    const pool = admin;
    admin = null;
    await pool?.end();
}

/**
 * Drops every schema this suite has ever made in the database at `url` - the leftovers of a
 * run that died before its teardown included. Only names matching {@link TEST_SCHEMA};
 * nothing else in the database is touched.
 */
export async function sweepTestSchemas(url: string): Promise<void> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        const { rows } = await client.query<{ name: string }>(
            "SELECT nspname AS name FROM pg_namespace WHERE nspname LIKE 't\\_%'"
        );
        for (const { name } of rows.filter((row) => TEST_SCHEMA.test(row.name))) {
            await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        }
    } finally {
        await client.end();
    }
}
