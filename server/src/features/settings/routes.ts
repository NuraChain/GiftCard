// Runtime configuration's handlers, and the admin key rotation beside them.
//
// Read ./settings.ts alongside this file: the write-only rule for credentials is enforced
// there, not here, so a new route added to this file cannot accidentally hand a secret back.
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import { ConflictError, UnauthorizedError } from '../../platform/http.ts';
import type { contract } from '../../contract/index.ts';
import { normalizeEmail } from '../../domain/email.ts';
import { normalizePhone } from '../../domain/phone.ts';
import type { MailSender } from '../checkout/mailer.ts';
import type { SmsSender } from '../checkout/panelsms.ts';
import type { NowPayments } from '../checkout/nowpayments.ts';
import type { PaymentGateway } from '../checkout/zarinpal.ts';
import { ADMIN_KEY_PATTERN, SESSION_COOKIE, type Admin } from '../console/session.ts';
import type { Settings } from './settings.ts';

export interface SettingsOptions {
    settings: Settings;
    admin: Admin;
    sms: SmsSender;
    mail: MailSender;
    payment: PaymentGateway;
    nowpayments: NowPayments;

    /** Derived from the public origin the console holds - see app.ts. */
    callbackUrl: () => string;
    nowPaymentsCallbackUrl: () => string;
    nowPaymentsReturnUrl: (lang: 'en') => string;

    log?: Logger;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type SettingsHandlers = Pick<
    Handlers<typeof contract>['admin'],
    | 'settings'
    | 'saveSettings'
    | 'settingsLog'
    | 'rotateKey'
    | 'testSms'
    | 'testGateway'
    | 'testEmail'
    | 'testNowPayments'
>;

/**
 * @internal What the test payment is opened for. Above both gateways' minimums, and never
 * charged: the payment is not paid, and nothing but paying it moves money.
 */
const TEST_TOMAN = 10_000;

export function settingsHandlers(options: SettingsOptions): SettingsHandlers {
    const { settings, admin, sms, mail, payment, nowpayments, callbackUrl, log } = options;

    /** The masked settings, with the two addresses that are derived rather than stored. */
    const view = () => ({
        ...settings.view(callbackUrl()),
        nowPaymentsCallbackUrl: options.nowPaymentsCallbackUrl()
    });

    return {
        // GET /api/admin/settings
        settings: () => view(),

        // POST /api/admin/settings
        saveSettings: ({ input }) => {
            // An ABSENT field keeps its value; an empty string is an explicit clear. That
            // distinction is what lets the console send only what changed without a blank
            // secret input wiping a working credential.
            settings.save(input);
            log?.warn({ fields: Object.keys(input) }, 'runtime settings changed');
            return view();
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
            const result = await sms.sendCode(phone, 'TEST-0000-0000', 0);
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        },

        // POST /api/admin/test-gateway
        testGateway: async () => {
            // Read before the call, so the answer names the gateway that was asked even when
            // the console switches it in the meantime.
            const gateway = settings.current().paymentGateway;
            const result = await payment.request({
                tomanAmount: TEST_TOMAN,
                description: 'آزمایش درگاه از کنسول',
                callbackUrl: callbackUrl()
            });
            // The payment page is NOT handed back. Paying it would take money for an order
            // that does not exist - there is nothing to deliver and nobody to deliver it to.
            return { ok: result.ok, reason: result.ok ? '' : result.reason, gateway };
        },

        // POST /api/admin/test-email
        testEmail: async ({ input }) => {
            const email = normalizeEmail(input.email);
            if (email === null) {
                throw new ConflictError('ایمیل معتبر نیست');
            }
            const result = await mail.sendCode(email, 'TEST-0000-0000', 0);
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        },

        // POST /api/admin/test-nowpayments
        testNowPayments: async () => {
            // An invoice nobody pays costs nothing and is simply never paid. Its page is not handed back, for the
            // reason given in `testGateway`; the order number is a throwaway one.
            const result = await nowpayments.request({
                usdAmount: 1,
                orderNumber: Date.now(),
                orderName: 'Console gateway test',
                callbackUrl: options.nowPaymentsCallbackUrl(),
                returnUrl: options.nowPaymentsReturnUrl('en')
            });
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        }
    };
}
