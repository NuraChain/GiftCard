// The SMS panel, spoken to the only way it listens: its "send by link" page.
//
//   sendsmslink.aspx?FROM=…&TO=…&TEXT=…&USERNAME=…&PASSWORD=…&DOMAIN=…
//
// IT ANSWERS 200 TO EVERYTHING. What it made of the request is a number on the first line of
// the body, with a whole HTML page underneath: `0` is sent, anything else is the panel's code
// for why not. So the status says nothing, and only an explicit `0` counts - an empty body, a
// page with no number, or a redirect to the panel's error page is a message that did not go,
// and reporting it as delivered would tell a buyer their code is on its way when it is not.
//
// THE PASSWORD TRAVELS IN THE URL, because that is the panel's API. Nothing here puts that URL
// in a reason or a log line.
import { displayPhone } from '../../domain/phone.ts';
import type { Fetch } from './zarinpal.ts';

export interface SmsSettings {
    /** The panel's `sendsmslink.aspx`. The sample link pasted whole works as well - see below. */
    apiUrl: string;
    username: string;
    password: string;

    /** What the panel calls DOMAIN: the reseller the account belongs to. */
    domain: string;

    /** The panel line the message is sent FROM. */
    sender: string;
    appName: string;
}

export type SmsResult = { ok: true } | { ok: false; reason: string };

export interface SmsSender {
    sendCode(phone: string, code: string, amountUsd: number): Promise<SmsResult>;
}

export interface SmsOptions {
    settings: () => SmsSettings;
    fetch?: Fetch;
    timeoutMs?: number;
}

export function createSms(options: SmsOptions): SmsSender {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;

    return {
        async sendCode(phone, code, amountUsd) {
            const live = options.settings();
            if (
                [live.apiUrl, live.username, live.password, live.domain, live.sender].includes('')
            ) {
                return { ok: false, reason: 'PanelSMS is not configured' };
            }

            try {
                // SET, not appended to a string: it encodes the Persian text and any `&` in a
                // password, and it REPLACES - so the panel's sample link, pasted into the
                // console with its `$FROM` placeholders still in it, sends the real values.
                const url = new URL(live.apiUrl);
                url.searchParams.set('FROM', live.sender);
                // The panel takes a number the way it is dialled in Iran: 0912…, not +98912….
                url.searchParams.set('TO', displayPhone(phone));
                url.searchParams.set(
                    'TEXT',
                    `کد گیفت کارت ${amountUsd} دلاری ${live.appName}: ${code}`
                );
                url.searchParams.set('USERNAME', live.username);
                url.searchParams.set('PASSWORD', live.password);
                url.searchParams.set('DOMAIN', live.domain);

                const response = await call(url.href, { signal: AbortSignal.timeout(timeoutMs) });
                if (response.redirected) {
                    // Checked BEFORE the status. A request the panel cannot make sense of is
                    // not answered with a code at all: it is sent to the panel's error page,
                    // and whatever status that page has says nothing about the message.
                    return {
                        ok: false,
                        reason: 'PanelSMS rejected the request (redirected to its error page)'
                    };
                }
                if (!response.ok) {
                    return { ok: false, reason: `PanelSMS returned HTTP ${response.status}` };
                }
                const answer = /^\s*(-?\d+)/.exec(await response.text())?.[1];
                if (answer === undefined) {
                    return { ok: false, reason: 'PanelSMS gave an unexpected response' };
                }
                // The code is passed on as it came. The panel's own web-service page is where
                // it is explained, and a guess at its meaning here would be a wrong one.
                return answer === '0'
                    ? { ok: true }
                    : { ok: false, reason: `PanelSMS returned code ${answer}` };
            } catch {
                return { ok: false, reason: 'PanelSMS is unreachable' };
            }
        }
    };
}
