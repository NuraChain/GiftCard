// Runtime configuration's wire shapes and routes, and the admin key beside them.
//
// A secret is WRITE-ONLY across this boundary. The console may replace the merchant id or
// the SMS key, and may see whether one is set and its last four characters - never the
// value. A stolen session must not be a way to read out the credentials it can overwrite.
// That rule is enforced in ./settings.ts, not in a handler, so a new route cannot leak one.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `@azerothjs/http/api/client`, `@azerothjs/schema` and `domain/`.
import { get, post } from '@azerothjs/http/api/client';
import { array, boolean, object, string, type Infer } from '@azerothjs/schema';

import { phoneField } from '../../domain/phone.ts';

export const settingsView = object({
    appName: string(),

    /** The gateway host in use, and whether it is the sandbox one. */
    zarinpalBase: string(),
    sandbox: boolean(),

    /** `••••5555`, or an empty string when nothing is configured. */
    merchantIdMasked: string(),
    merchantIdSet: boolean(),

    kavenegarKeyMasked: string(),
    kavenegarKeySet: boolean(),
    kavenegarTemplate: string(),
    kavenegarBase: string(),

    /** Delivery only runs when both the key and the template are present. */
    smsReady: boolean(),

    /** Read-only, from the environment: where the gateway returns the buyer. */
    callbackUrl: string(),

    /** True once the admin key has been rotated into the database. */
    keyRotated: boolean()
});

/**
 * Every field is optional: the console sends only what changed, so leaving a secret blank
 * means "keep it" rather than "erase it". Erasing is an explicit empty-string write.
 */
export const settingsInput = object({
    appName: string({ trim: true, max: 60 }).optional(),
    zarinpalBase: string({ trim: true, max: 200 }).optional(),
    merchantId: string({ trim: true, max: 100 }).optional(),
    kavenegarKey: string({ trim: true, max: 200 }).optional(),
    kavenegarTemplate: string({ trim: true, max: 100 }).optional(),
    kavenegarBase: string({ trim: true, max: 200 }).optional()
});

/** One recorded change. Values are masked here too - the log is not a way around write-only. */
export const settingsLogRow = object({
    key: string(),
    before: string(),
    after: string(),
    changedAt: string()
});

export const settingsLog = object({ entries: array(settingsLogRow) });

/**
 * Rotating demands the CURRENT key even though a session is already open. A session proves
 * someone was the admin at sign-in; replacing the credential should prove they still are.
 */
export const rotateKeyInput = object({
    currentKey: string({ trim: true, max: 32 }),
    newKey: string({ trim: true, max: 32 })
});

/** Proving a Kavenegar template is approved without selling something first. */
export const testSmsInput = object({ phone: phoneField });
export const testSmsResult = object({ ok: boolean(), reason: string() });

export type SettingsView = Infer<typeof settingsView>;
export type SettingsLogRow = Infer<typeof settingsLogRow>;

/** This feature's routes. They join the `admin` group in ../../contract/index.ts. */
export const settingsRoutes = {
    settings: get('/admin/settings', { output: settingsView }),
    saveSettings: post('/admin/settings', { input: settingsInput, output: settingsView }),
    settingsLog: get('/admin/settings/log', { output: settingsLog }),
    rotateKey: post('/admin/key', { input: rotateKeyInput }),
    testSms: post('/admin/test-sms', { input: testSmsInput, output: testSmsResult })
};
