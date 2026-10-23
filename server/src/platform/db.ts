// Opening the database, and the handle every query module runs its SQL on.
//
// This is the ONLY file that knows how a connection is made. A feature's query module
// receives the open handle and never opens one itself, which is what lets a test run the
// whole app against a schema of its own in a real PostgreSQL - the engine that ships rather
// than a fake, so the claim semantics under test are the ones that ship.
import pg from 'pg';
import { DataSource, MigrationExecutor, type DataSourceOptions, type QueryResult } from 'typeorm';

import { ENTITIES } from './entities.ts';
import { InitialSchema1792800000000 } from './migrations/1792800000000-initial-schema.ts';

/** Where the database is - all that differs between a deployment and a test. */
export interface Connection {
    /** A PostgreSQL connection string. It carries the password, so it is never logged. */
    url: string;

    /** The schema the tables live in: `public`, unless a test gives every store its own. */
    schema?: string;

    /** Connections the pool may hold. */
    poolSize?: number;
}

/** What a query module runs its SQL on: the pool, or one transaction's own connection. */
export interface Sql {
    /** One statement's rows, under the columns' own snake_case names. */
    rows<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;

    /** One statement's first row, or undefined. */
    row<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;

    /** A write, answered with how many rows it touched. */
    run(sql: string, params?: readonly unknown[]): Promise<number>;
}

/** The open database. */
export interface Database extends Sql {
    /**
     * Runs `work` in ONE transaction, on one connection: committed when it resolves, rolled
     * back when it throws. Only what goes through `tx` is inside it - a statement sent through
     * the handle itself takes another connection and commits on its own.
     *
     * Nothing inside `work` may wait on the network: the transaction holds its connection and
     * its row locks until it settles.
     */
    transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;

    /** Runs read-only `work` against ONE consistent state of the whole database. */
    snapshot<T>(work: (tx: Sql) => Promise<T>): Promise<T>;

    close(): Promise<void>;
}

/** A schema name that needs no quoting anywhere it is spelled - see {@link dataSourceOptions}. */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const CLOSED = 'database: the store is closed';
const OUTLIVED = 'database: a statement outlived the transaction it was written in';

/** The one member of TypeORM's options union the shop is opened with. */
export type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/**
 * The TypeORM configuration every connection is opened with. The invariants are written down
 * here once - the driver, the entities, the migrations, how an int8 crosses into JS, how long
 * anything may wait, which schema a bare table name means - so a deployment and the suite
 * differ only in WHERE they connect, never in how.
 */
export function dataSourceOptions(connection: Connection): PostgresOptions {
    const schema = connection.schema ?? 'public';
    if (!SCHEMA_NAME.test(schema)) {
        throw new Error(`database: '${schema}' is not a plain lower-case schema name`);
    }
    return {
        type: 'postgres',
        // Handed over rather than left to TypeORM to `require`: the server's own copy of pg.
        driver: pg,
        url: connection.url,
        schema,
        poolSize: connection.poolSize ?? 10,
        applicationName: 'ashbringer',
        // A Toman price, a gateway reference and a hold's deadline are all int8, and pg hands
        // int8 to JS as a STRING unless told otherwise. None of them gets near 2^53. Checked
        // when the database opens, because the switch is one global for the whole process.
        parseInt8: true,
        installExtensions: false,
        synchronize: false,
        migrationsRun: false,
        entities: ENTITIES,
        // An explicit list like the entities, never a glob.
        migrations: [InitialSchema1792800000000],
        extra: {
            // pg waits forever by default, for a connection and for a statement alike. A
            // database that stops answering must cost a request an error, not hold it - and a
            // checkout's row locks - for as long as the database takes.
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 30_000,
            statement_timeout: 30_000,
            lock_timeout: 10_000,
            idle_in_transaction_session_timeout: 60_000,
            keepAlive: true,
            // The query modules name their tables bare, so every connection resolves them in
            // this one schema: production's `public`, or the one a test store is given.
            options: `-c search_path=${schema}`
        }
    };
}

/**
 * Connects, refuses a database the shop cannot be correct against, and migrates it.
 *
 * `onMigrate` is called with the names of any migrations that ran. A schema change nobody
 * logged is a mystery six months later.
 */
export async function openDatabase(
    connection: Connection,
    onMigrate?: (names: string[]) => void
): Promise<Database> {
    const options = dataSourceOptions(connection);
    const source = new DataSource(options);
    await source.initialize();
    try {
        await verify(source);
        const applied = await migrate(source, options.schema ?? 'public');
        if (applied.length > 0) {
            onMigrate?.(applied);
        }
    } catch (error) {
        await source.destroy().catch(() => undefined);
        throw error;
    }
    return handle(source);
}

/** True when `error` is PostgreSQL refusing a write that would duplicate a unique key. */
export function isUniqueViolation(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === '23505';
}

/**
 * An int8 that came back as text means something in this process turned pg's parseInt8 off,
 * and every price and reference would cross as a string. An encoding other than UTF8 would
 * refuse the first Persian title written, and every one after.
 */
async function verify(source: DataSource): Promise<void> {
    const [row] = (await source.query(
        "SELECT 1::int8 AS one, current_setting('server_encoding') AS encoding"
    )) as Array<{ one: unknown; encoding: unknown }>;
    if (typeof row?.one !== 'number') {
        throw new Error("database: an int8 came back as text - pg's parseInt8 is off");
    }
    if (row.encoding !== 'UTF8') {
        throw new Error(`database: the encoding is ${String(row.encoding)}; the shop needs UTF8`);
    }
}

/**
 * Applies every pending migration, on ONE connection, inside ONE transaction.
 *
 * The advisory lock belongs to that transaction, so it can never be left behind on a pooled
 * connection: two processes booting at once take turns rather than both creating the same
 * tables, and the second finds nothing pending.
 */
async function migrate(source: DataSource, schema: string): Promise<string[]> {
    const runner = source.createQueryRunner();
    try {
        await runner.connect();
        await runner.startTransaction();
        await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `ashbringer:migrate:${schema}`
        ]);
        const executor = new MigrationExecutor(source, runner);
        // Joins the transaction above rather than opening one of its own.
        executor.transaction = 'all';
        const applied = await executor.executePendingMigrations();
        await runner.commitTransaction();
        return applied.map((migration) => migration.name);
    } catch (error) {
        if (runner.isTransactionActive) {
            await runner.rollbackTransaction().catch(() => undefined);
        }
        throw error;
    } finally {
        await runner.release();
    }
}

/** The three statement shapes, over whatever sends a statement and answers its result. */
function statements(execute: (sql: string, params: unknown[]) => Promise<QueryResult>): Sql {
    return {
        async rows<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
            return (await execute(sql, [...params])).records as T[];
        },
        async row<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
            return (await execute(sql, [...params])).records[0] as T | undefined;
        },
        async run(sql: string, params: readonly unknown[] = []): Promise<number> {
            return (await execute(sql, [...params])).affected ?? 0;
        }
    };
}

function handle(source: DataSource): Database {
    let closed = false;

    async function atomically<T>(readOnly: boolean, work: (tx: Sql) => Promise<T>): Promise<T> {
        if (closed) {
            throw new Error(CLOSED);
        }
        const runner = source.createQueryRunner();
        try {
            await runner.connect();
            await runner.startTransaction(readOnly ? 'REPEATABLE READ' : undefined);
            if (readOnly) {
                await runner.query('SET TRANSACTION READ ONLY');
            }
            // Dead the moment `work` settles - before COMMIT, so a statement it left running
            // cannot slip in after the outcome is decided.
            let live = true;
            const tx = statements((sql, params) => {
                if (!live) {
                    throw new Error(OUTLIVED);
                }
                return runner.query(sql, params, true);
            });
            try {
                const result = await work(tx).finally(() => {
                    live = false;
                });
                await runner.commitTransaction();
                return result;
            } catch (error) {
                live = false;
                if (runner.isTransactionActive) {
                    await runner.rollbackTransaction().catch(() => undefined);
                }
                throw error;
            }
        } finally {
            await runner.release();
        }
    }

    return {
        ...statements(async (sql, params) => {
            if (closed) {
                throw new Error(CLOSED);
            }
            const runner = source.createQueryRunner();
            try {
                return await runner.query(sql, params, true);
            } finally {
                await runner.release();
            }
        }),

        transaction: (work) => atomically(false, work),
        snapshot: (work) => atomically(true, work),

        async close() {
            if (closed) {
                return;
            }
            closed = true;
            await source.destroy();
        }
    };
}
