// The whole database as one SQL script: what the scheduled Telegram backup carries.
//
// IN PROCESS, NOT pg_dump. The backup has to work on the machine the shop runs on, which has
// Node and a connection string and no reason to have PostgreSQL's client tools, and it must
// keep working after the server it talks to is upgraded past whatever pg_dump is installed.
// What is needed is small: seven tables, data only, restored into a database the shop has
// already made its own schema in.
import type { Database } from './db.ts';

/**
 * Every table, with the key a dump orders it by. No table refers to another, so a restore may
 * write them in any order.
 */
const TABLES: ReadonlyArray<readonly [table: string, key: string]> = [
    ['tiers', 'amount'],
    ['codes', 'id'],
    ['orders', 'id'],
    ['gateway_payments', 'id'],
    ['redemptions', 'code'],
    ['settings', 'key'],
    ['settings_log', 'id']
];

/**
 * The BIGSERIAL keys. A restore writes their values explicitly, so each sequence has to be
 * moved past the rows it brought back, or the next insert collides with one of them.
 */
const SERIALS = ['codes', 'gateway_payments', 'settings_log'] as const;

/** Rows per INSERT: short enough to read, long enough that a restore is not a statement a row. */
const ROWS_PER_INSERT = 200;

/**
 * One value as a SQL literal. Text has its quotes doubled - the script turns
 * standard_conforming_strings on, so a backslash is only ever a backslash.
 */
function literal(value: unknown): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'string') {
        return `'${value.replaceAll("'", "''")}'`;
    }
    throw new Error(`dump: cannot write a ${typeof value} into a script`);
}

/**
 * The script, read from ONE consistent state of the database: a purchase committing mid-dump
 * is either wholly in it or wholly absent - never half.
 *
 * Data only, inside one transaction that first empties every table, so restoring it twice
 * gives the same shop and a restore that fails part-way changes nothing.
 */
export function dumpSql(db: Database): Promise<string> {
    return db.snapshot(async (tx) => {
        const out = [
            `-- Ashbringer, ${new Date().toISOString()}.`,
            '-- Restore into a database the shop has migrated - start it once against an empty',
            '-- one, then stop it - with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <this file>',
            'SET standard_conforming_strings = on;',
            "SET client_encoding = 'UTF8';",
            'BEGIN;',
            `TRUNCATE ${TABLES.map(([table]) => table).join(', ')};`
        ];
        for (const [table, key] of TABLES) {
            const rows = await tx.rows<Record<string, unknown>>(
                `SELECT * FROM ${table} ORDER BY ${key}`
            );
            if (rows.length === 0) {
                continue;
            }
            const columns = Object.keys(rows[0]);
            for (let at = 0; at < rows.length; at += ROWS_PER_INSERT) {
                const values = rows
                    .slice(at, at + ROWS_PER_INSERT)
                    .map((row) => `(${columns.map((column) => literal(row[column])).join(', ')})`);
                out.push(
                    `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`
                );
            }
        }
        for (const table of SERIALS) {
            out.push(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table};`
            );
        }
        out.push('COMMIT;', '');
        return out.join('\n');
    });
}
