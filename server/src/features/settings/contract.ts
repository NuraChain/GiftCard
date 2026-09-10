// Runtime configuration's wire shapes and routes, and the admin key beside them.
//
// A secret is WRITE-ONLY across this boundary. The console may replace the merchant id or
// the SMTP password, and may see whether one is set and its last four characters - never the
// value. A stolen session must not be a way to read out the credentials it can overwrite.
// That rule is enforced in ./settings.ts, not in a handler, so a new route cannot leak one.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';
import { emailField } from '../../domain/email.ts';

export const settingsView = z.object({
    appName: z.string(),

    /** The gateway host in use, and whether it is the sandbox one. */
    zarinpalBase: z.string(),
    sandbox: z.boolean(),

    /** `••••5555`, or an empty string when nothing is configured. */
    merchantIdMasked: z.string(),
    merchantIdSet: z.boolean(),

    /** Where gift-code email is handed off, and how. The password never comes back. */
    smtpHost: z.string(),
    smtpPort: z.number(),
    smtpSecure: z.boolean(),
    smtpUser: z.string(),
    smtpPasswordMasked: z.string(),
    smtpPasswordSet: z.boolean(),
    smtpFrom: z.string(),

    /** The two exchanges the tether rate is cross-checked between. */
    nobitexBase: z.string(),
    wallexBase: z.string(),

    /** The markup over the tether rate, in percent. Every card's price rides on it. */
    marginPercent: z.number(),

    /** Delivery only runs when both a host and a From address are present. */
    mailReady: z.boolean(),

    /** Read-only, from the environment: where the gateway returns the buyer. */
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
    zarinpalBase: z.string().trim().max(200).optional(),
    merchantId: z.string().trim().max(100).optional(),
    smtpHost: z.string().trim().max(200).optional(),
    smtpPort: z.number().int().min(1).max(65_535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpUser: z.string().trim().max(200).optional(),
    smtpPassword: z.string().max(200).optional(),
    smtpFrom: z.string().trim().max(254).optional(),

    /** The operations bot. The token is write-only; a blank one means "keep it". */
    telegramBotToken: z.string().trim().max(200).optional(),
    telegramChatId: z.string().trim().max(64).optional(),
    telegramBase: z.string().trim().max(200).optional(),
    nobitexBase: z.string().trim().max(200).optional(),
    wallexBase: z.string().trim().max(200).optional(),

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
