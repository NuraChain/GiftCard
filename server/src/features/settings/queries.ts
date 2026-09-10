// The settings rows, and the audit beside them.
//
// This module knows nothing about what a setting MEANS - not which are secret, not how they
// are sealed. That lives in `features/settings/settings.ts`; here a value is a string in a row.
import type { DatabaseSync } from 'node:sqlite';

import { shaped } from '../../platform/db.ts';
import type { SettingsStore } from '../../db/types.ts';

export function createSettingQueries(db: DatabaseSync): SettingsStore {
    const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
    const putSetting = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const insertSettingLog = db.prepare(
        'INSERT INTO settings_log (key, before, after, changed_at) VALUES (?, ?, ?, ?)'
    );
    const selectSettingLog = db.prepare(
        'SELECT key, before, after, changed_at FROM settings_log ORDER BY id DESC LIMIT ?'
    );

    return {
        getSetting(key) {
            return shaped<{ value: string } | undefined>(getSetting.get(key))?.value;
        },

        putSetting(key, value) {
            putSetting.run(key, value);
        },

        logSetting(entry) {
            insertSettingLog.run(entry.key, entry.before, entry.after, entry.changedAt);
        },

        settingsLog(limit) {
            return shaped<
                Array<{ key: string; before: string; after: string; changed_at: string }>
            >(selectSettingLog.all(limit)).map((row) => ({
                key: row.key,
                before: row.before,
                after: row.after,
                changedAt: row.changed_at
            }));
        }
    };
}
