// Runtime configuration's handlers, and the admin key rotation beside them.
//
// Read ./settings.ts alongside this file: the write-only rule for credentials is enforced
// there, not here, so a new route added to this file cannot accidentally hand a secret back.
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import { ConflictError, UnauthorizedError } from '../../platform/http.ts';
import type { contract } from '../../contract/index.ts';
import { normalizePhone } from '../../domain/phone.ts';
import type { SmsSender } from '../checkout/sms.ts';
import { ADMIN_KEY_PATTERN, SESSION_COOKIE, type Admin } from '../console/session.ts';
import type { Settings } from './settings.ts';

export interface SettingsOptions {
    settings: Settings;
    admin: Admin;
    sms: SmsSender;
    callbackUrl: string;
    log?: Logger;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type SettingsHandlers = Pick<
    Handlers<typeof contract>['admin'],
    'settings' | 'saveSettings' | 'settingsLog' | 'rotateKey' | 'testSms'
>;

export function settingsHandlers(options: SettingsOptions): SettingsHandlers {
    const { settings, admin, sms, callbackUrl, log } = options;

    return {
        // GET /api/admin/settings
        settings: () => settings.view(callbackUrl),

        // POST /api/admin/settings
        saveSettings: ({ input }) => {
            // An ABSENT field keeps its value; an empty string is an explicit clear. That
            // distinction is what lets the console send only what changed without a blank
            // secret input wiping a working credential.
            settings.save(input);
            log?.warn({ fields: Object.keys(input) }, 'runtime settings changed');
            return settings.view(callbackUrl);
        },

        // GET /api/admin/settings/log
        settingsLog: () => ({ entries: settings.log(50) }),

        // POST /api/admin/key
        rotateKey: ({ input, request, reply }) => {
            // A session proves someone was the admin at sign-in. Replacing the credential
            // should prove they still are, so the current key is required even though this
            // route already sits behind the guard.
            if (!settings.matchesAdminKey(input.currentKey)) {
                throw new UnauthorizedError('کلید فعلی نادرست است');
            }
            if (!ADMIN_KEY_PATTERN.test(input.newKey)) {
                throw new ConflictError('کلید تازه باید به شکل XXXX-XXXX-XXXX-XXXX باشد');
            }
            settings.rotateAdminKey(input.newKey);
            // Every open session dies with the old key, including this one: a rotation that
            // leaves the previous holder signed in has not rotated anything.
            admin.signOutAll();
            log?.warn('admin key rotated');

            const cookie = admin.signOut(request.cookies[SESSION_COOKIE]);
            reply.setCookie(cookie.name, cookie.value, cookie.options);
        },

        // POST /api/admin/test-sms
        testSms: async ({ input }) => {
            const phone = normalizePhone(input.phone);
            if (phone === null) {
                throw new ConflictError('شماره موبایل معتبر نیست');
            }
            // A sample that looks like a code but is obviously not one: proving the template
            // is approved must not hand out anything redeemable.
            const result = await sms.sendCode(phone, 'TEST-0000-0000');
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        }
    };
}
