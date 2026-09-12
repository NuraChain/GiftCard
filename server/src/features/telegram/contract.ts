// Telegram's wire shapes: is it on, and the two buttons that prove it.
//
// Both routes DO something outward - one posts a message, one uploads the whole database - so
// both are guarded and throttled in app.ts. They exist because there is no other way to find
// out whether a bot token works: the alternative is waiting for a sale, or waiting an hour.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';

export const telegramStatus = z.object({
    /** True when a bot token and a chat are both set. Nothing is attempted otherwise. */
    configured: z.boolean(),

    /** `••••1234`, or empty. The token is write-only, exactly like the other credentials. */
    botTokenMasked: z.string(),
    botTokenSet: z.boolean(),

    chatId: z.string(),
    baseUrl: z.string(),

    /**
     * How often the database is sent, in minutes. Echoed back rather than written here: it is
     * a setting, saved through `POST /admin/settings` like every other one, and this view is
     * where the console reads the live value to show and to pre-fill its box with.
     */
    backupEveryMinutes: z.number().int()
});

/** What a test message or a manual backup did. `reason` is empty when it worked. */
export const telegramAction = z.object({ ok: z.boolean(), reason: z.string() });

export type TelegramStatusView = z.infer<typeof telegramStatus>;

/** This feature's routes. They join the `admin` group in ../../contract/index.ts. */
export const telegramRoutes = {
    telegram: get('/admin/telegram', { output: telegramStatus }),
    testTelegram: post('/admin/telegram/test', { output: telegramAction }),
    backupNow: post('/admin/telegram/backup', { output: telegramAction })
};
