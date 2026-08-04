// Runtime configuration's routes, and the admin key rotation beside them.
//
// Read ./settings.ts alongside this file: the write-only rule for credentials is enforced
// there, not here, so a new route added to this file cannot accidentally hand a secret back.
import { ConflictError, UnauthorizedError, type RequestContext } from '@azerothjs/http';
import type { Verbs } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import { normalizePhone } from '../../domain/phone.ts';
import { throttle } from '../../platform/throttle.ts';
import type { SmsSender } from '../checkout/sms.ts';
import { ADMIN_KEY_PATTERN, type Admin } from '../console/session.ts';
import { rotateKeyInput, settingsInput, settingsLog, settingsView, testSmsInput, testSmsResult } from './schemas.ts';
import type { Settings } from './settings.ts';

export interface SettingsOptions
{
    settings: Settings;
    admin: Admin;
    sms: SmsSender;
    callbackUrl: string;

    /**
     * The feature's own guard, passed in because the two throttled routes below must RE-STATE
     * it: `routes.with(...)` replaces the feature chain rather than adding to it, so a route
     * that wants a ceiling has to name the session guard too or it would lose it.
     */
    requireAdmin: (context: RequestContext) => void;

    log?: Logger;
}

/** Runtime configuration's half of the admin surface; app.ts lands it inside the guarded feature. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
export function settingsRoutes(routes: Verbs<Record<never, never>, '/admin'>, options: SettingsOptions)
{
    const { settings, admin, sms, callbackUrl, requireAdmin, log } = options;

    return {
        settings: routes.get('/settings', { output: settingsView }, () => settings.view(callbackUrl)),

        saveSettings: routes.post('/settings', { input: settingsInput, output: settingsView }, ({ input }) =>
        {
            // An ABSENT field keeps its value; an empty string is an explicit clear. That
            // distinction is what lets the console send only what changed without a blank
            // secret input wiping a working credential.
            settings.save(input);
            log?.warn('runtime settings changed', { fields: Object.keys(input) });
            return settings.view(callbackUrl);
        }),

        settingsLog: routes.get('/settings/log', { output: settingsLog }, () => ({ entries: settings.log(50) })),

        // Rotation takes the CURRENT key, so it is one more place a credential can be guessed at.
        rotateKey: routes.with(requireAdmin, throttle(10, 60_000)).post('/key', { input: rotateKeyInput }, (context) =>
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
        }),

        testSms: routes.with(requireAdmin, throttle(5, 60_000)).post('/test-sms', { input: testSmsInput, output: testSmsResult }, async ({ input }) =>
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
        })
    };
}
