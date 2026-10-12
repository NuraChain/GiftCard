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
import { telegramProxy } from '../../contract/shared.ts';

/** A proxy as the console is shown it: where it is, and whether it has a password - not which. */
export const telegramProxyView = telegramProxy
    .omit({ password: true })
    .extend({ passwordSet: z.boolean() });

export const telegramStatus = z.object({
    /** True when a bot token and a chat are both set. Nothing is attempted otherwise. */
    configured: z.boolean(),

    /** `••••1234`, or empty. The token is write-only, exactly like the other credentials. */
    botTokenMasked: z.string(),
    botTokenSet: z.boolean(),

    chatId: z.string(),
    baseUrl: z.string(),

    /** The proxies the bot reaches the API host through, in the order they are tried. */
    proxies: z.array(telegramProxyView),

    /**
     * How often the database is sent, in minutes. Echoed back rather than written here: it is
     * a setting, saved through `POST /admin/settings` like every other one, and this view is
     * where the console reads the live value to show and to pre-fill its box with.
     */
    backupEveryMinutes: z.number().int()
});

/** What a test message or a manual backup did. `reason` is empty when it worked. */
export const telegramAction = z.object({ ok: z.boolean(), reason: z.string() });

/**
 * What testing one proxy found. `ms` is how long Telegram took to answer THROUGH it, which is
 * the number that says which of two working proxies belongs at the top of the list.
 */
export const telegramProxyTest = z.object({
    ok: z.boolean(),
    reason: z.string(),
    ms: z.number().int()
});

export type TelegramStatusView = z.infer<typeof telegramStatus>;
export type TelegramProxyView = z.infer<typeof telegramProxyView>;
export type TelegramProxyTest = z.infer<typeof telegramProxyTest>;

/** This feature's routes. They join the `admin` group in ../../contract/index.ts. */
export const telegramRoutes = {
    telegram: get('/admin/telegram', { output: telegramStatus }),
    testTelegram: post('/admin/telegram/test', { output: telegramAction }),

    // Takes the proxy itself rather than its place in the list, so one can be tried before
    // it is saved. A saved one comes without its password, which the console was never given,
    // and is tried with the one stored for its address.
    testTelegramProxy: post('/admin/telegram/proxy-test', {
        input: telegramProxy,
        output: telegramProxyTest
    }),
    backupNow: post('/admin/telegram/backup', { output: telegramAction })
};
