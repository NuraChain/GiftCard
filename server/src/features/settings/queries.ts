// The settings rows, and the audit beside them.
//
// This module knows nothing about what a setting MEANS - not which are secret, not how they
// are sealed. That lives in `features/settings/settings.ts`; here a value is a string in a row.
import type { Database } from '../../platform/db.ts';
import type { SettingsStore } from '../../db/types.ts';

export function createSettingQueries(db: Database): SettingsStore {
    return {
        async allSettings() {
            const rows = await db.rows<{ key: string; value: string }>(
                'SELECT key, value FROM settings'
            );
            return new Map(rows.map((row) => [row.key, row.value]));
        },

        async putSetting(key, value) {
            await db.run(
                'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                [key, value]
            );
        },

        async logSetting(entry) {
            await db.run(
                'INSERT INTO settings_log (key, before, after, changed_at) VALUES ($1, $2, $3, $4)',
                [entry.key, entry.before, entry.after, entry.changedAt]
            );
        },

        async settingsLog(limit) {
            const rows = await db.rows<{
                key: string;
                before: string;
                after: string;
                changed_at: string;
            }>(
                'SELECT key, before, after, changed_at FROM settings_log ORDER BY id DESC LIMIT $1',
                [limit]
            );
            return rows.map((row) => ({
                key: row.key,
                before: row.before,
                after: row.after,
                changedAt: row.changed_at
            }));
        }
    };
}
