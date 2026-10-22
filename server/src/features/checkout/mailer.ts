// Email through Resend: the English shop's delivery, as ./panelsms.ts is the Persian shop's.
//
// The delivery CONTRACT is the one rule 4 in ./checkout.ts states: a failure here is a
// NOTICE, never a failed purchase. The money has moved and the code is stored and on the
// buyer's screen, so a mail provider having a bad afternoon is never dressed up as a payment
// that did not work.
//
// RESEND'S HTTP API RATHER THAN SMTP: one POST with a bearer token, no connection pool, no
// STARTTLS, no outbound port a host quietly blocks.
//
// THE BASE URL IS A SETTING, and that is not decoration. This ships to operators in Iran,
// where `api.resend.com` may be unreachable; pointing it at a relay is the difference between
// a working shop and a rewrite. Same reason `telegramBase` is a setting.
//
// TWO THINGS ABOUT RESEND THAT BITE, both worth knowing before blaming this file:
//   - `onboarding@resend.dev` only delivers to the address that owns the Resend account.
//     Selling to real buyers needs a domain verified in Resend and a From address on it.
//   - The API key is write-only here, like every other credential (features/settings/).
//
// This file was here once before, when the Persian shop delivered by email, and was removed
// when it moved to SMS. What came back is the same client with an English, left-to-right
// message.
import { randomUUID } from 'node:crypto';

import type { Fetch } from './zarinpal.ts';

/** What the mailer needs to know, read fresh on every send. */
export interface MailSettings {
    /** The Resend API key (`re_...`). Empty means delivery is off. */
    apiKey: string;

    /** The From address, on a domain verified in Resend. `Shop <codes@example.com>` works too. */
    from: string;

    /** The API host. A setting so a blocked network can be routed around without a deploy. */
    baseUrl: string;

    /** The shop's name, for the subject line and the signature. */
    appName: string;
}

export interface MailerOptions {
    /** Read PER CALL: the credentials are editable from the console without a restart. */
    settings: () => MailSettings;

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

/** What the app depends on - so a test can hand it a spy. */
export interface MailSender {
    sendCode(email: string, code: string, amountUsd: number): Promise<MailResult>;
}

/** Whether both the key and the From address are set. */
export function mailConfigured(live: Pick<MailSettings, 'apiKey' | 'from'>): boolean {
    return live.apiKey !== '' && live.from !== '';
}

/** @internal The code and the shop name are the only interpolations, and both are escaped. */
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/**
 * The message a buyer receives.
 *
 * BOTH a plain-text and an HTML part. The text part is not a fallback nobody reads: the code
 * is the one thing in this message that must survive being forwarded, quoted, or opened with
 * styling off. It sits on its OWN LINE in both parts, so a double-click selects the code and
 * only the code.
 */
export function composeCodeMail(
    settings: MailSettings,
    email: string,
    code: string,
    amountUsd: number
): OutgoingMail {
    const subject = `Your $${amountUsd} gift card code - ${settings.appName}`;
    const warning = 'This code does not expire. Keep it somewhere safe and do not share it.';

    const text = [
        'Hello,',
        '',
        `Your $${amountUsd} gift card code is ready:`,
        '',
        code,
        '',
        warning,
        '',
        settings.appName
    ].join('\n');

    // A COMPLETE DOCUMENT, not a bare <div>: spam classifiers score malformed HTML, and some
    // clients read the charset from the document rather than the MIME part.
    const html = [
        '<!DOCTYPE html>',
        '<html lang="en" dir="ltr">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${escapeHtml(subject)}</title>`,
        '</head>',
        '<body style="margin:0;padding:24px;background:#ffffff">',
        '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111">',
        '<p>Hello,</p>',
        `<p>Your $${amountUsd} gift card code is ready:</p>`,
        '<p style="margin:24px 0">',
        '<span style="display:inline-block;font-family:monospace;font-size:18px;' +
            'font-weight:bold;letter-spacing:1px;padding:12px 16px;border:1px solid #ddd;' +
            `border-radius:8px;background:#fafafa">${escapeHtml(code)}</span>`,
        '</p>',
        `<p>${warning}</p>`,
        `<p style="color:#666">${escapeHtml(settings.appName)}</p>`,
        '</div>',
        '</body>',
        '</html>'
    ].join('');

    return { to: email, subject, text, html };
}

/**
 * Builds the sender. An unconfigured mailer REPORTS a failure rather than throwing: "no API
 * key yet" degrades to exactly the state an outage produces - the buyer sees the code and the
 * notice that no message was sent.
 */
export function createMailer(options: MailerOptions): MailSender {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

    async function deliver(live: MailSettings, message: OutgoingMail): Promise<MailResult> {
        let response: Response;
        try {
            response = await call(`${live.baseUrl}/emails`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${live.apiKey}`,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    from: live.from,
                    to: message.to,
                    subject: message.subject,
                    text: message.text,
                    html: message.html,

                    // STOPS GMAIL COLLAPSING THESE INTO ONE THREAD. Every code email has the
                    // same structure and near-identical subjects, so Gmail folds them and hides
                    // all but the newest - which a buyer reads as "my code never arrived". A
                    // fresh random id per message breaks that up. NEVER the gift code: a header
                    // travels through relays and sits in logs, and the code is bearer value.
                    headers: { 'X-Entity-Ref-ID': randomUUID() }
                }),
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch {
            return { ok: false, reason: 'Resend is unreachable' };
        }

        if (response.ok) {
            return { ok: true };
        }

        // Resend answers a refusal with a 4xx and a `message`. It is the only part worth an
        // operator's time - it is where "the domain is not verified" actually appears.
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        return {
            ok: false,
            reason:
                typeof body?.message === 'string'
                    ? `Resend refused the message (${response.status}): ${body.message}`
                    : `Resend refused the message (${response.status})`
        };
    }

    return {
        sendCode(email, code, amountUsd) {
            const live = options.settings();
            if (!mailConfigured(live)) {
                // NAMED, not "not configured": the operator is usually missing exactly one.
                const missing = [
                    live.apiKey === '' ? 'API key' : '',
                    live.from === '' ? 'From address' : ''
                ].filter((name) => name !== '');
                return Promise.resolve({
                    ok: false,
                    reason: `Resend ${missing.join(' and ')} not set`
                });
            }
            return deliver(live, composeCodeMail(live, email, code, amountUsd));
        }
    };
}
