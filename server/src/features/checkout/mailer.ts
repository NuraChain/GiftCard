// Email, used only to deliver a code someone already paid for.
//
// This replaces the Kavenegar SMS client. The delivery CONTRACT is unchanged and it is the
// important part: a failure here is a NOTICE, never a failed purchase. The money has already
// moved and the code is already stored and on the buyer's screen, so a mail server having a
// bad afternoon must never be dressed up as a payment that did not work.
//
// RESEND'S HTTP API RATHER THAN SMTP. It is one POST with a bearer token, which means no
// connection pool, no STARTTLS negotiation, no port that a host quietly blocks outbound, and
// no long-lived socket to go stale between sales. It also drops a dependency: this file used
// to carry nodemailer, and now it carries `fetch`.
//
// THE BASE URL IS A SETTING, and that is not decoration. This ships to operators in Iran,
// where `api.resend.com` may be unreachable in either direction; pointing it at a relay is the
// difference between a working shop and a rewrite. Same reason `telegramBase` is a setting.
//
// TWO THINGS ABOUT RESEND THAT BITE, both worth knowing before blaming this file:
//   - `onboarding@resend.dev` only delivers to the address that owns the Resend account.
//     Selling to real buyers needs a domain verified in Resend and a From address on it.
//   - The API key is write-only here, like every other credential (features/settings/) - it
//     can be replaced from the console and never read back out.
//
// `fetch` is INJECTED the same way the gateway and the Telegram client take it: it is what
// lets every path here - a 401, a 429, a timeout, a body that will not parse - be tested
// without a network or an account.
import type { Fetch } from './zarinpal.ts';

/** What the mailer needs to know, read fresh on every send. */
export interface MailSettings {
    /** The Resend API key (`re_...`). Empty means delivery is off. */
    apiKey: string;

    /**
     * The From address. Resend refuses anything that is not on a domain verified against the
     * account - except `onboarding@resend.dev`, which only reaches the account's own owner.
     */
    from: string;

    /** The API host. A setting so a blocked network can be routed around without a deploy. */
    baseUrl: string;

    /** The shop's name, for the subject line and the signature. */
    appName: string;
}

export interface MailerOptions {
    /**
     * Read PER CALL: the credentials are editable from the console, so turning delivery on
     * must not need a restart. An empty host or from-address still means delivery is off -
     * decided at send time rather than at construction.
     */
    settings: () => MailSettings;

    /** Injected so the tests can drive every path without a mail server. */
    send?: (settings: MailSettings, message: OutgoingMail) => Promise<void>;

    fetch?: Fetch;

    timeoutMs?: number;
}

/** One message, already rendered. Kept separate so a test can assert on what was composed. */
export interface OutgoingMail {
    to: string;
    subject: string;
    text: string;
    html: string;
}

export type MailResult = { ok: true } | { ok: false; reason: string };

/** What the app depends on - one method, so a test can hand it a spy. */
export interface MailSender {
    sendCode(email: string, code: string, amountUsd: number): Promise<MailResult>;
}

/**
 * The message a buyer receives.
 *
 * BOTH a plain-text and an HTML part. The text part is not a fallback nobody reads: a code is
 * the one thing in this message that must survive being forwarded, quoted, or opened in a
 * client with images and styling off, and a bare line of text does that where a styled table
 * does not.
 *
 * The code is on its OWN LINE with nothing else on it, in both parts, so that a double-click
 * selects the code and only the code.
 */
export function composeCodeMail(
    settings: MailSettings,
    email: string,
    code: string,
    amountUsd: number
): OutgoingMail {
    const subject = `کد گیفت کارت ${amountUsd} دلاری شما - ${settings.appName}`;

    const text = [
        'سلام،',
        '',
        `کد گیفت کارت ${amountUsd} دلاری شما آماده است:`,
        '',
        code,
        '',
        'این کد بدون تاریخ انقضاست. آن را جایی امن نگه دارید و برای کسی نفرستید.',
        '',
        settings.appName
    ].join('\n');

    // `dir="rtl"` on the wrapper, and the code itself in an LTR island: without that the
    // Latin characters of a UUID reorder against the Persian text around them and the buyer
    // copies a code that is not the one they were sent.
    const html = [
        '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#111">',
        '<p>سلام،</p>',
        `<p>کد گیفت کارت ${amountUsd} دلاری شما آماده است:</p>`,
        '<p style="margin:24px 0">',
        '<span dir="ltr" style="display:inline-block;font-family:monospace;font-size:18px;' +
            'font-weight:bold;letter-spacing:1px;padding:12px 16px;border:1px solid #ddd;' +
            `border-radius:8px;background:#fafafa">${escapeHtml(code)}</span>`,
        '</p>',
        '<p>این کد بدون تاریخ انقضاست. آن را جایی امن نگه دارید و برای کسی نفرستید.</p>',
        `<p style="color:#666">${escapeHtml(settings.appName)}</p>`,
        '</div>'
    ].join('');

    return { to: email, subject, text, html };
}

/** @internal The code and the shop name are the only interpolations, and both are escaped. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Builds the sender. An unconfigured mailer REPORTS a failure rather than throwing or
 * pretending: the shop's whole delivery contract is that a code is valid whether or not the
 * message arrives, so "no API key yet" degrades to exactly the state an outage produces - the
 * buyer sees the code and the notice that no message was sent.
 */
export function createMailer(options: MailerOptions): MailSender {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

    /**
     * @internal One POST to Resend. Throws on anything that is not an accepted message, and
     * what it throws with is what the console shows the operator.
     */
    const deliver =
        options.send ??
        (async (settings: MailSettings, message: OutgoingMail): Promise<void> => {
            const response = await call(`${settings.baseUrl}/emails`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${settings.apiKey}`,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    from: settings.from,
                    to: message.to,
                    subject: message.subject,
                    text: message.text,
                    html: message.html
                }),
                signal: AbortSignal.timeout(timeoutMs)
            });

            if (response.ok) {
                return;
            }

            // Resend answers a refusal with a 4xx and `{"name":"...","message":"..."}`. The
            // `message` is the only part worth an operator's time - it is where "the domain is
            // not verified" and "you can only send to your own address" actually appear.
            const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
            throw new Error(
                typeof body?.message === 'string'
                    ? body.message
                    : `resend refused the message (${response.status})`
            );
        });

    return {
        /**
         * Sends the code. The caller treats a failure as a NOTICE, never an error: the
         * payment already succeeded and the code is stored and on screen, so a mail outage
         * must not be presented as a failed purchase.
         */
        async sendCode(email: string, code: string, amountUsd: number): Promise<MailResult> {
            const live = options.settings();

            // NAMED, not "not configured". Two fields have to be set and the operator is
            // usually missing exactly one of them; a message that does not say which sends
            // them back to re-check the field that was already right.
            const missing = [
                live.apiKey === '' ? 'کلید Resend' : '',
                live.from === '' ? 'آدرس فرستنده' : ''
            ].filter((name) => name !== '');

            if (missing.length > 0) {
                return { ok: false, reason: `${missing.join(' و ')} تنظیم نشده است` };
            }

            try {
                await deliver(live, composeCodeMail(live, email, code, amountUsd));
                return { ok: true };
            } catch (error) {
                // The reason reaches the console and the log, never the buyer - a provider's
                // rejection quotes it verbatim and that can name the account.
                return {
                    ok: false,
                    reason: error instanceof Error ? error.message : 'resend unreachable'
                };
            }
        }
    };
}
