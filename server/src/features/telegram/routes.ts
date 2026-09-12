// Telegram's handlers: what is configured, and the two ways to prove it works.
//
// The test message and the manual backup are the only ways an operator can find out whether a
// bot token is right without waiting for a sale or waiting out the backup interval - and
// finding out at 3am, from the absence of a message, is not finding out.
import type { Handlers } from '../../platform/api.ts';
import type { contract } from '../../contract/index.ts';
import type { Settings } from '../settings/settings.ts';
import type { BackupJob } from './notify.ts';
import type { Telegram } from './telegram.ts';

export interface TelegramOptions {
    telegram: Telegram;
    backup: BackupJob;
    settings: Settings;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type TelegramHandlers = Pick<
    Handlers<typeof contract>['admin'],
    'telegram' | 'testTelegram' | 'backupNow'
>;

/** @internal `••••5678`: enough to tell two bots apart, not enough to drive one. */
function mask(value: string): string {
    if (value === '') {
        return '';
    }
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export function telegramHandlers(options: TelegramOptions): TelegramHandlers {
    const { telegram, backup, settings } = options;

    return {
        // GET /api/admin/telegram
        telegram: () => {
            const live = settings.current();
            return {
                configured: telegram.configured(),
                // Write-only, like every other credential: the console may replace the token
                // and see its last four characters, never read it back.
                botTokenMasked: mask(live.telegramBotToken),
                botTokenSet: live.telegramBotToken !== '',
                chatId: live.telegramChatId,
                baseUrl: live.telegramBase,
                backupEveryMinutes: live.backupEveryMinutes
            };
        },

        // POST /api/admin/telegram/test
        testTelegram: async () => {
            const result = await telegram.sendMessage(
                `پیام آزمایشی از ${settings.current().appName}. ` +
                    'اگر این را می‌بینید، اعلان فروش و پشتیبان‌گیری کار می‌کند.'
            );
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        },

        // POST /api/admin/telegram/backup
        backupNow: async () => {
            const result = await backup.runNow();
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        }
    };
}
