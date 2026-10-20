// The SMS panel, spoken to either of the two ways it listens. Which one is decided by the
// address the console was given: a `.asmx` address is the panel's SOAP web service, and
// anything else is its "send by link" page.
//
//   sendsmslink.aspx?FROM=…&TO=…&TEXT=…&USERNAME=…&PASSWORD=…&DOMAIN=…
//   service.asmx  POST <SendSMS><username/><password/><text/><mobileno/><pnlno/></SendSMS>
//
// THE LINK PAGE ANSWERS 200 TO EVERYTHING. What it made of the request is a number on the
// first line of the body, with a whole HTML page underneath: `0` is sent, anything else is the
// panel's code for why not. So the status says nothing, and only an explicit `0` counts - an
// empty body, a page with no number, or a redirect to the panel's error page is a message that
// did not go, and reporting it as delivered would tell a buyer their code is on its way when
// it is not.
//
// THE WEB SERVICE needs no DOMAIN and answers in a SOAP envelope, still HTTP 200 for a refusal:
// the result is the one `<SendSMSResult>` in it, and its success code is `2`, not `0`. The
// panel's PHP sample also sends `isflash`; the service's own WSDL does not list it, so it is
// not sent.
//
// THE PASSWORD TRAVELS IN THE URL, or in the envelope, because that is the panel's API.
// Nothing here puts either in a reason or a log line.
import { displayPhone } from '../../domain/phone.ts';
import type { Fetch } from './zarinpal.ts';

export interface SmsSettings {
    /**
     * The panel's `sendsmslink.aspx`, or its web service's `service.asmx`. The sample link
     * pasted whole works, and so does the WSDL address - see below.
     */
    apiUrl: string;
    username: string;
    password: string;

    /** What the panel calls DOMAIN: the reseller the account belongs to. Link page only. */
    domain: string;

    /** The panel line the message is sent FROM (the web service calls it `pnlno`). */
    sender: string;
    appName: string;
}

export type SmsResult = { ok: true } | { ok: false; reason: string };

export interface SmsSender {
    sendCode(phone: string, code: string, amountUsd: number): Promise<SmsResult>;

    /** Any message, to any number. `sendCode` is this with the buyer's wording. */
    sendText(phone: string, text: string): Promise<SmsResult>;
}

export interface SmsOptions {
    settings: () => SmsSettings;
    fetch?: Fetch;
    timeoutMs?: number;
}

/**
 * @internal What the web service's answers to `SendSMS` mean, from the panel's own table of
 * them. An answer missing from it is still passed on, just without a meaning.
 */
const SOAP_ANSWERS: Record<string, string> = {
    '-3': 'username and password do not match',
    '10': 'wrong username or password',
    '66': 'username and password do not match',
    '11': 'the text has a character the panel does not allow',
    '1111': 'the text has a character the panel does not allow',
    '-17': 'the text is empty',
    '-18': 'credit error',
    '-19': 'not enough panel credit',
    '-22': 'the mobile number is not valid',
    '-23': 'the line may not send this way',
    '-24': 'the panel line is wrong',
    '-25': 'the panel line has expired',
    '4': 'the recipient has blocked promotional messages',
    '9': "the line owner's details are not registered and approved",
    '12': 'the panel line is not yet allowed to send',
    '13': 'sent from an IP address the panel does not allow',
    Hang: 'the account is blocked',
    'Doc No': 'the second step of registration is not done'
};

/** Whether an address is the panel's SOAP web service rather than its send-by-link page. */
export function isSoapUrl(apiUrl: string): boolean {
    try {
        return new URL(apiUrl).pathname.toLowerCase().endsWith('.asmx');
    } catch {
        return false;
    }
}

/** Whether every setting the chosen way of sending needs is filled in. */
export function smsConfigured(live: Omit<SmsSettings, 'appName'>): boolean {
    const needed = [live.apiUrl, live.username, live.password, live.sender];
    if (!isSoapUrl(live.apiUrl)) {
        needed.push(live.domain);
    }
    return !needed.includes('');
}

/** @internal Text made safe to put between two XML tags. */
function xml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

export function createSms(options: SmsOptions): SmsSender {
    const call = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;

    async function viaLink(live: SmsSettings, phone: string, text: string): Promise<SmsResult> {
        try {
            // SET, not appended to a string: it encodes the Persian text and any `&` in a
            // password, and it REPLACES - so the panel's sample link, pasted into the
            // console with its `$FROM` placeholders still in it, sends the real values.
            const url = new URL(live.apiUrl);
            url.searchParams.set('FROM', live.sender);
            // The panel takes a number the way it is dialled in Iran: 0912…, not +98912….
            url.searchParams.set('TO', displayPhone(phone));
            url.searchParams.set('TEXT', text);
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
            // The code is passed on as it came: the web service's table of codes is not
            // this page's, and a guess at its meaning here would be a wrong one.
            return answer === '0'
                ? { ok: true }
                : { ok: false, reason: `PanelSMS returned code ${answer}` };
        } catch {
            return { ok: false, reason: 'PanelSMS is unreachable' };
        }
    }

    async function viaSoap(live: SmsSettings, phone: string, text: string): Promise<SmsResult> {
        try {
            // Origin and path only: the address pasted into the console may well be the
            // WSDL's, `service.asmx?wsdl`, and the call goes to the service itself.
            const url = new URL(live.apiUrl);
            const envelope =
                '<?xml version="1.0" encoding="utf-8"?>' +
                '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
                '<soap:Body><SendSMS xmlns="http://tempuri.org/">' +
                `<username>${xml(live.username)}</username>` +
                `<password>${xml(live.password)}</password>` +
                `<text>${xml(text)}</text>` +
                `<mobileno>${xml(displayPhone(phone))}</mobileno>` +
                `<pnlno>${xml(live.sender)}</pnlno>` +
                '</SendSMS></soap:Body></soap:Envelope>';

            const response = await call(`${url.origin}${url.pathname}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    SOAPAction: '"http://tempuri.org/SendSMS"'
                },
                body: envelope,
                signal: AbortSignal.timeout(timeoutMs)
            });
            // A SOAP fault is a 500 with the fault in the body, and a fault can quote the
            // request back - so it is reported by its status alone.
            if (!response.ok) {
                return { ok: false, reason: `PanelSMS returned HTTP ${response.status}` };
            }
            const answer = /<SendSMSResult>([^<]*)<\/SendSMSResult>/
                .exec(await response.text())?.[1]
                ?.trim();
            if (answer === undefined || answer === '') {
                return { ok: false, reason: 'PanelSMS gave an unexpected response' };
            }
            if (answer === '2') {
                return { ok: true };
            }
            const meaning = SOAP_ANSWERS[answer];
            return {
                ok: false,
                reason:
                    meaning === undefined
                        ? `PanelSMS returned code ${answer}`
                        : `PanelSMS returned code ${answer}: ${meaning}`
            };
        } catch {
            return { ok: false, reason: 'PanelSMS is unreachable' };
        }
    }

    function send(live: SmsSettings, phone: string, text: string): Promise<SmsResult> {
        if (!smsConfigured(live)) {
            return Promise.resolve({ ok: false, reason: 'PanelSMS is not configured' });
        }
        return isSoapUrl(live.apiUrl) ? viaSoap(live, phone, text) : viaLink(live, phone, text);
    }

    return {
        // The amount is no longer in the message; the parameter stays for the callers.
        sendCode(phone, code) {
            const live = options.settings();
            return send(live, phone, `کد گیفت کارت شما\n\n${code}\n\nفروشگاه ${live.appName}\n`);
        },

        sendText(phone, text) {
            return send(options.settings(), phone, text);
        }
    };
}
