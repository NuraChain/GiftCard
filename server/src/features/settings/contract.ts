// Runtime configuration's wire shapes and routes, and the admin key beside them.
//
// A secret is WRITE-ONLY across this boundary. The console may replace the merchant id or
// the Resend key, and may see whether one is set and its last four characters - never the
// value. A stolen session must not be a way to read out the credentials it can overwrite.
// That rule is enforced in ./settings.ts, not in a handler, so a new route cannot leak one.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';
import { emailField } from '../../domain/email.ts';
import { MAX_TETHER_TOMAN, MIN_TETHER_TOMAN } from '../../domain/pricing.ts';

/**
 * The band the automatic backup interval has to land in, in minutes.
 *
 * THE FLOOR IS NOT ARBITRARY. Every backup is a VACUUM of the whole database, a compression
 * pass and a full upload to a chat server, so a gap short enough for two of them to overlap
 * turns one mistyped number into a machine that spends its day copying itself. The ceiling is
 * a week, past which "automatic" has stopped meaning anything - an operator who wants backups
 * rarer than that wants them off, and clearing the chat id is how that is said.
 *
 * It lives here, beside the field it guards, rather than in `domain/`: a backup cadence is an
 * operational choice about this deployment, not a rule about what a gift card is.
 */
export const MIN_BACKUP_MINUTES = 5;
export const MAX_BACKUP_MINUTES = 7 * 24 * 60;

/** The gap until somebody chooses one. Hourly is what this shop ran on before it was settable. */
export const DEFAULT_BACKUP_MINUTES = 60;

export const settingsView = z.object({
    appName: z.string(),

    /** The public origin the buyer reaches the shop on. The gateway returns them here. */
    publicBaseUrl: z.string(),

    /** The gateway host in use, and whether it is the sandbox one. */
    zarinpalBase: z.string(),
    sandbox: z.boolean(),

    /** `••••5555`, or an empty string when nothing is configured. */
    merchantIdMasked: z.string(),
    merchantIdSet: z.boolean(),

    /** How gift-code email is sent. The API key never comes back - only its last four. */
    resendApiKeyMasked: z.string(),
    resendApiKeySet: z.boolean(),
    mailFrom: z.string(),
    resendBase: z.string(),

    /** What one USDT costs in Toman, as the console last set it. Zero means never set. */
    tetherToman: z.number(),

    /** When that number was last changed, ISO. Empty when it never has been. */
    tetherSetAt: z.string(),

    /** The markup over the tether rate, in percent. Every card's price rides on it. */
    marginPercent: z.number(),

    /** Delivery only runs when both an API key and a From address are present. */
    mailReady: z.boolean(),

    /**
     * Where the gateway returns the buyer, derived from `publicBaseUrl` and echoed back so the
     * console can show the exact URL to paste into Zarinpal's panel. Read-only: it is computed,
     * never stored, so there is no second copy to drift.
     */
    callbackUrl: z.string(),

    /** True once the admin key has been rotated into the database. */
    keyRotated: z.boolean()
});

/**
 * Every field is optional: the console sends only what changed, so leaving a secret blank
 * means "keep it" rather than "erase it". Erasing is an explicit empty-string write.
 */
export const settingsInput = z.object({
    appName: z.string().trim().max(60).optional(),
    publicBaseUrl: z.string().trim().max(200).optional(),
    zarinpalBase: z.string().trim().max(200).optional(),
    merchantId: z.string().trim().max(100).optional(),
    /** The Resend key is write-only: a blank one means "keep it", never "erase it". */
    resendApiKey: z.string().trim().max(200).optional(),
    mailFrom: z.string().trim().max(254).optional(),
    resendBase: z.string().trim().max(200).optional(),

    /** The operations bot. The token is write-only; a blank one means "keep it". */
    telegramBotToken: z.string().trim().max(200).optional(),
    telegramChatId: z.string().trim().max(64).optional(),
    telegramBase: z.string().trim().max(200).optional(),

    /**
     * How many minutes between automatic database backups. Bounded at the boundary for the
     * same reason the margin is: the console sits behind a session, but a session is not a
     * reason to accept a one-minute interval that uploads the entire shop all day long.
     */
    backupEveryMinutes: z.number().int().min(MIN_BACKUP_MINUTES).max(MAX_BACKUP_MINUTES).optional(),

    /**
     * The tether rate, in Toman. ZERO OR A PLAUSIBLE RATE, nothing between: zero is the
     * operator deliberately pulling the shop off sale, and the band is the fat-finger guard
     * from domain/pricing.ts. A number below the band is far more likely to be a rate missing
     * a digit than an intention, so it is refused at the boundary rather than stored and
     * multiplied across every card.
     */
    tetherToman: z
        .union([z.literal(0), z.number().int().min(MIN_TETHER_TOMAN).max(MAX_TETHER_TOMAN)])
        .optional(),

    /**
     * The one number here that is money. Bounded at the boundary rather than trusted: the
     * console is behind a session, but a session is not a reason to accept a 5,000% margin
     * or a NaN, and `tomanPrice` refuses both far too late to be useful.
     */
    marginPercent: z.number().min(0).max(100).optional()
});

/** One recorded change. Values are masked here too - the log is not a way around write-only. */
export const settingsLogRow = z.object({
    key: z.string(),
    before: z.string(),
    after: z.string(),
    changedAt: z.string()
});

export const settingsLog = z.object({ entries: z.array(settingsLogRow) });

/**
 * Rotating demands the CURRENT key even though a session is already open. A session proves
 * someone was the admin at sign-in; replacing the credential should prove they still are.
 */
export const rotateKeyInput = z.object({
    currentKey: z.string().trim().max(32),
    newKey: z.string().trim().max(32)
});

/** Proving the mail settings work without selling something first. */
export const testEmailInput = z.object({ email: emailField });
export const testEmailResult = z.object({ ok: z.boolean(), reason: z.string() });

export type SettingsView = z.infer<typeof settingsView>;
export type SettingsInput = z.infer<typeof settingsInput>;
export type SettingsLogRow = z.infer<typeof settingsLogRow>;

/** This feature's routes. They join the `admin` group in ../../contract/index.ts. */
export const settingsRoutes = {
    settings: get('/admin/settings', { output: settingsView }),
    saveSettings: post('/admin/settings', { input: settingsInput, output: settingsView }),
    settingsLog: get('/admin/settings/log', { output: settingsLog }),
    rotateKey: post('/admin/key', { input: rotateKeyInput }),
    testEmail: post('/admin/test-email', { input: testEmailInput, output: testEmailResult })
};
