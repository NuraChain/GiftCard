// The bot's command side: what it does, what it refuses, and who it refuses to listen to.
//
// `handle()` is driven directly, so every command below runs against a REAL settings object and
// a REAL SQLite database with no bot, no network and no timer. The claims worth making are that
// a price typed into a chat reaches the shop's own pricing function, and that a message from
// the wrong chat reaches nothing at all.
import { describe, it, expect } from 'vitest';

import { createCommandBot } from '../src/features/telegram/commands.ts';
import { createTetherRate } from '../src/features/rate/rate.ts';
import { createSettings } from '../src/features/settings/settings.ts';
import { createStore } from '../src/db/index.ts';
import { seedTiers } from '../src/domain/seed.ts';
import { tomanPrice } from '../src/domain/pricing.ts';
import type { BackupJob } from '../src/features/telegram/notify.ts';
import type { Telegram, TelegramUpdate } from '../src/features/telegram/telegram.ts';

const CHAT = '-100999';

function harness(options: { backup?: BackupJob; updates?: TelegramUpdate[] } = {}) {
    const store = createStore(':memory:');
    for (const tier of seedTiers()) {
        store.saveTier(tier);
    }
    const settings = createSettings({ store });
    settings.save({ telegramBotToken: 'x', telegramChatId: CHAT });

    const rate = createTetherRate({
        settings: () => {
            const live = settings.current();
            return { tetherToman: live.tetherToman, tetherSetAt: live.tetherSetAt };
        }
    });

    const sent: string[] = [];
    let pending = options.updates ?? [];
    const telegram: Telegram = {
        configured: () => true,
        sendMessage: (text) => {
            sent.push(text);
            return Promise.resolve({ ok: true });
        },
        sendDocument: () => Promise.resolve({ ok: true }),
        receive: () => {
            const batch = pending;
            pending = [];
            return Promise.resolve(batch);
        }
    };

    const backup = options.backup ?? {
        runNow: () => Promise.resolve({ ok: true as const }),
        start: () => (): void => {}
    };

    const bot = createCommandBot({ telegram, settings, rate, store, backup });
    return { bot, settings, rate, store, sent };
}

describe('the bot commands', () => {
    it('sets the tether rate and reads the new prices back', async () => {
        const h = harness();

        const reply = await h.bot.handle('/setprice 245000');

        expect(h.settings.current().tetherToman).toBe(245_000);
        expect(h.rate.current()?.toman).toBe(245_000);

        // The reply quotes the SHOP'S OWN arithmetic, not a restatement of the input - so an
        // operator sees what a buyer would actually be charged.
        const margin = h.settings.current().marginPercent;
        expect(reply).toContain(tomanPrice(5, 245_000, margin).toLocaleString('en-US'));
        h.store.close();
    });

    it('accepts a Persian-keyboard number and a grouped one', async () => {
        // `Number('۲۴۵۰۰۰')` is NaN. Refusing it would be the shop telling its own operator
        // their keyboard is wrong.
        const h = harness();

        await h.bot.handle('/setprice ۲۴۵۰۰۰');
        expect(h.settings.current().tetherToman).toBe(245_000);

        await h.bot.handle('/setprice 250,000');
        expect(h.settings.current().tetherToman).toBe(250_000);
        h.store.close();
    });

    it('refuses a rate outside the band without changing anything', async () => {
        const h = harness();
        await h.bot.handle('/setprice 245000');

        // One zero too many. There is no second source to disagree with it any more.
        const reply = await h.bot.handle('/setprice 2450000000');

        expect(reply).toContain('باید بین');
        expect(h.settings.current().tetherToman).toBe(245_000);
        h.store.close();
    });

    it('shouts when the new rate is far from the old one, but still applies it', async () => {
        // 24,500 for 245,000 lands INSIDE the band and would sell every card at a tenth. A
        // chat cannot ask "are you sure" and wait, so the reply is loud and immediate.
        const h = harness();
        await h.bot.handle('/setprice 245000');

        const reply = await h.bot.handle('/setprice 24500');

        expect(reply).toContain('هشدار');
        expect(h.settings.current().tetherToman).toBe(24_500);
        h.store.close();
    });

    it('sets the margin, and refuses an absurd one', async () => {
        const h = harness();

        await h.bot.handle('/margin 12');
        expect(h.settings.current().marginPercent).toBe(12);

        await h.bot.handle('/margin 900');
        expect(h.settings.current().marginPercent).toBe(12);
        h.store.close();
    });

    it('answers /status and /stock from the real database', async () => {
        const h = harness();
        h.store.addCodes(5, [crypto.randomUUID(), crypto.randomUUID()]);

        expect(await h.bot.handle('/status')).toContain('بسته');
        await h.bot.handle('/setprice 245000');
        expect(await h.bot.handle('/status')).toContain('باز');
        expect(await h.bot.handle('/stock')).toContain('2');
        h.store.close();
    });

    it('names the commands rather than going silent on a typo', async () => {
        const h = harness();
        expect(await h.bot.handle('/setpirce 245000')).toContain('/setprice');
        h.store.close();
    });

    it('ONLY obeys the configured chat', async () => {
        // The whole security model. Anyone can find a bot and message it; what stops them is
        // that their chat id is not the one in the settings.
        const h = harness({
            updates: [
                { updateId: 1, chatId: '555', chatUsername: '@stranger', text: '/setprice 1000' }
            ]
        });

        const stop = h.bot.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        stop();

        expect(h.settings.current().tetherToman).toBe(0);
        // Not even a refusal: replying would confirm the bot is live to whoever probed it.
        expect(h.sent).toEqual([]);
        h.store.close();
    });

    it('obeys the configured chat and answers into it', async () => {
        const h = harness({
            updates: [{ updateId: 7, chatId: CHAT, chatUsername: '', text: '/setprice 245000' }]
        });

        const stop = h.bot.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        stop();

        expect(h.settings.current().tetherToman).toBe(245_000);
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]).toContain('245,000');
        h.store.close();
    });

    it('strips the @botname Telegram adds in a group', async () => {
        const h = harness();
        await h.bot.handle('/setprice@guardian_ops_bot 245000');
        expect(h.settings.current().tetherToman).toBe(245_000);
        h.store.close();
    });

    it('reports a failed backup instead of claiming one was sent', async () => {
        const h = harness({
            backup: {
                runNow: () =>
                    Promise.resolve({ ok: false as const, reason: 'telegram unreachable' }),
                start: () => (): void => {}
            }
        });

        expect(await h.bot.handle('/backup')).toContain('telegram unreachable');
        h.store.close();
    });
});
