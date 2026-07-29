// Runtime configuration's handlers, and the admin key rotation beside them.
//
// Read ./settings.ts alongside this file: the write-only rule for credentials is enforced
// there, not here, so a new route added to this file cannot accidentally hand a secret back.
import { ConflictError, UnauthorizedError } from '@azerothjs/http';
import type { HandlersWithGuards } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import type { contract } from '../../contract/index.ts';
import { normalizePhone } from '../../domain/phone.ts';
import type { SmsSender } from '../checkout/sms.ts';
import { ADMIN_KEY_PATTERN, type Admin } from '../console/session.ts';
import type { Settings } from './settings.ts';

export interface SettingsOptions
{
    settings: Settings;
    admin: Admin;
    sms: SmsSender;
    callbackUrl: string;
    log?: Logger;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type SettingsHandlers = Pick<
    HandlersWithGuards<typeof contract, Record<never, never>>['admin'],
    'settings' | 'saveSettings' | 'settingsLog' | 'rotateKey' | 'testSms'
>;

export function settingsHandlers(options: SettingsOptions): SettingsHandlers
{
    const { settings, admin, sms, callbackUrl, log } = options;

    return {
        // GET /api/admin/settings
        settings: () => settings.view(callbackUrl),

        // POST /api/admin/settings
        saveSettings: ({ input }: { input: Record<string, string | undefined> }) =>
        {
            // An ABSENT field keeps its value; an empty string is an explicit clear. That
            // distinction is what lets the console send only what changed without a blank
            // secret input wiping a working credential.
            settings.save(input);
            log?.warn('runtime settings changed', { fields: Object.keys(input) });
            return settings.view(callbackUrl);
        },

        // GET /api/admin/settings/log
        settingsLog: () => ({ entries: settings.log(50) }),

        // POST /api/admin/key
        rotateKey: (context: { request: Request; input: { currentKey: string; newKey: string } }) =>
        {
            // A session proves someone was the admin at sign-in. Replacing the credential
            // should prove they still are, so the current key is required even though this
            // route already sits behind the guard.
            if (!settings.matchesAdminKey(context.input.currentKey))
            {
                throw new UnauthorizedError('کلید فعلی نادرست است');
            }
            if (!ADMIN_KEY_PATTERN.test(context.input.newKey))
            {
                throw new ConflictError('کلید تازه باید به شکل XXXX-XXXX-XXXX-XXXX باشد');
            }
            settings.rotateAdminKey(context.input.newKey);
            // Every open session dies with the old key, including this one: a rotation that
            // leaves the previous holder signed in has not rotated anything.
            admin.signOutAll();
            log?.warn('admin key rotated');
            return new Response(null, { status: 204, headers: { 'set-cookie': admin.signOut(context.request) } });
        },

        // POST /api/admin/test-sms
        testSms: async ({ input }: { input: { phone: string } }) =>
        {
            const phone = normalizePhone(input.phone);
            if (phone === null)
            {
                throw new ConflictError('شماره موبایل معتبر نیست');
            }
            // A sample that looks like a code but is obviously not one: proving the template
            // is approved must not hand out anything redeemable.
            const result = await sms.sendCode(phone, 'TEST-0000-0000');
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        }
    };
}
