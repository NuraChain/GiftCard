// Kavenegar, used only to deliver a code someone already paid for.
//
// This uses verify/lookup.json, NOT sms/send.json. Kavenegar's documentation is explicit
// that Lookup messages carry the highest priority and are never filtered - including to
// people who have blocked advertising SMS. A gift code is the definition of a message that
// must arrive, and a buyer who once opted out of marketing has not opted out of the thing
// they just bought. Lookup also needs no `sender`: the service picks the line.
//
// Two constraints from that API shape the code format upstream: a `token` may not contain
// a space and is capped at 100 characters. `NC-XXXX-XXXX` satisfies both.

import type { Fetch } from './zarinpal.ts';

export interface SmsOptions {
    /**
     * Read PER CALL: the key and the template are editable from the console, so turning
     * delivery on must not need a restart. An empty key or template still means delivery is
     * off - now decided at send time rather than at construction.
     */
    settings: () => { apiKey: string; template: string; baseUrl: string };

    fetch?: Fetch;
    timeoutMs?: number;
}

export type SmsResult = { ok: true } | { ok: false; reason: string };

/** What the app depends on - one method, so a test can hand it a spy. */
export interface SmsSender {
    sendCode(phone: string, code: string): Promise<SmsResult>;
}

/** Kavenegar's documented failures, in the words the operator needs to act on. */
function explain(status: number | undefined): string {
    switch (status) {
        case 411:
            return 'recipient rejected by the SMS provider';
        case 418:
            return 'SMS account is out of credit';
        case 424:
            return 'SMS template not found or not approved';
        case 426:
            return 'SMS account needs the advanced service enabled';
        default:
            return `SMS provider returned ${status ?? 'no status'}`;
    }
}

/**
 * Builds the sender. An unconfigured provider REPORTS a failure rather than throwing or
 * pretending: the shop's whole delivery contract is that a code is valid whether or not the
 * message arrives, so "no key yet" degrades to exactly the state a provider outage produces
 * - the buyer sees the code and the notice that no message was sent.
 */
export function createSms(options: SmsOptions): SmsSender {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;

    return {
        /**
         * Sends the code. The caller treats a failure as a NOTICE, never an error: the
         * payment already succeeded and the code is stored and on screen, so a provider
         * outage must not be presented as a failed purchase.
         */
        async sendCode(phone: string, code: string): Promise<SmsResult> {
            const live = options.settings();
            if (live.apiKey === '' || live.template === '') {
                return { ok: false, reason: 'SMS delivery is not configured' };
            }

            const url = new URL(`${live.baseUrl}/v1/${live.apiKey}/verify/lookup.json`);
            url.searchParams.set('receptor', phone);
            url.searchParams.set('token', code);
            url.searchParams.set('template', live.template);

            try {
                const response = await call(url.toString(), {
                    signal: AbortSignal.timeout(timeoutMs)
                });
                const body = (await response.json()) as { return?: { status?: number } };
                const status = body?.return?.status;
                return status === 200 ? { ok: true } : { ok: false, reason: explain(status) };
            } catch {
                return { ok: false, reason: 'SMS provider unreachable' };
            }
        }
    };
}
