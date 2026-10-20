import { describe, expect, it, vi } from 'vitest';

import { createSms } from '../src/features/checkout/panelsms.ts';

const SETTINGS = {
    apiUrl: 'https://panel.example.test/sendsmslink.aspx',
    username: 'shop-user',
    password: 'p@ss&word',
    domain: '0098',
    sender: '30001234',
    appName: 'اشبرینگر'
};

/** What the panel really sends: the result on the first line, and a whole page under it. */
function panelAnswer(code: string): Response {
    return new Response(
        `${code}\r\n\r\n<!DOCTYPE html><html><head><title>پنل</title></head></html>`
    );
}

/** A fetch that answers every call the same way and remembers what it was asked. */
function panel(answer: () => Response) {
    return vi.fn<(input: string, init?: RequestInit) => Promise<Response>>((_input, _init) =>
        Promise.resolve(answer())
    );
}

describe('PanelSMS sender', () => {
    it('calls the send-by-link page with the six things the panel asks for', async () => {
        const fetch = panel(() => panelAnswer('0'));
        const sms = createSms({ settings: () => SETTINGS, fetch });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledOnce();

        const [href, init] = fetch.mock.calls[0] as [string, RequestInit];
        // A link, so a GET: no method, no body and no header carrying a credential.
        expect(init.method).toBeUndefined();
        expect(init.body).toBeUndefined();

        const url = new URL(href);
        expect(`${url.origin}${url.pathname}`).toBe(SETTINGS.apiUrl);
        // Read back through the parser, which is what proves the Persian text and the `&` in
        // the password survived being put in a query string.
        expect(Object.fromEntries(url.searchParams)).toEqual({
            FROM: '30001234',
            // The way the number is dialled in Iran, not the +98 form the shop stores it in.
            TO: '09121234567',
            TEXT: 'کد گیفت کارت شما\n\nNC-1234-5678\n\nفروشگاه اشبرینگر\n',
            USERNAME: 'shop-user',
            PASSWORD: 'p@ss&word',
            DOMAIN: '0098'
        });
    });

    it('fills in the sample link when that is what was pasted into the console', async () => {
        // The panel's documentation is a link with placeholders in it, and pasting that whole
        // into the address box is the obvious thing to do.
        const fetch = panel(() => panelAnswer('0'));
        const sms = createSms({
            settings: () => ({
                ...SETTINGS,
                apiUrl:
                    'https://panel.example.test/sendsmslink.aspx?FROM=$FROM&TO=$TO&TEXT=$TEXT' +
                    '&USERNAME=$USERNAME\n&PASSWORD=$PASSWORD&DOMAIN=$DOMAIN'
            }),
            fetch
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });

        const url = new URL(fetch.mock.calls[0][0]);
        expect(url.searchParams.getAll('TO')).toEqual(['09121234567']);
        expect(url.searchParams.getAll('PASSWORD')).toEqual(['p@ss&word']);
        expect(url.href).not.toContain('$');
    });

    it('passes on the code the panel refused the message with', async () => {
        // Still HTTP 200: the panel says no in the body, not in the status.
        const sms = createSms({ settings: () => SETTINGS, fetch: panel(() => panelAnswer('6')) });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS returned code 6'
        });
    });

    it('counts nothing but an explicit 0 as sent', async () => {
        // An empty body and a page with no result on it both read as zero to a careless
        // parser - and "sent" is the one answer that must never be a guess, because it is
        // what tells a buyer their code is on its way.
        for (const body of ['', '<html><body>خطا</body></html>', 'OK']) {
            const sms = createSms({
                settings: () => SETTINGS,
                fetch: panel(() => new Response(body))
            });

            expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10), body).toEqual({
                ok: false,
                reason: 'PanelSMS gave an unexpected response'
            });
        }
    });

    it('does not take the panel error page it was redirected to for an answer', async () => {
        // Whatever that page says and whatever its status: neither is about the message.
        for (const page of [panelAnswer('0'), new Response('', { status: 500 })]) {
            Object.defineProperty(page, 'redirected', { value: true });
            const sms = createSms({ settings: () => SETTINGS, fetch: panel(() => page) });

            expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
                ok: false,
                reason: 'PanelSMS rejected the request (redirected to its error page)'
            });
        }
    });

    it('reports an HTTP refusal without turning a paid order into a delivery success', async () => {
        const sms = createSms({
            settings: () => SETTINGS,
            fetch: () => Promise.resolve(new Response('', { status: 503 }))
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS returned HTTP 503'
        });
    });

    it('keeps the password out of the reason when the panel cannot be reached', async () => {
        const sms = createSms({
            settings: () => SETTINGS,
            // What a failed fetch really throws carries the URL it was asked for.
            fetch: (input) => Promise.reject(new Error(`request to ${input} failed`))
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS is unreachable'
        });
    });

    it('does not make a network request until all settings are configured', async () => {
        for (const missing of ['apiUrl', 'username', 'password', 'domain', 'sender'] as const) {
            const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
            const sms = createSms({ settings: () => ({ ...SETTINGS, [missing]: '' }), fetch });

            expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10), missing).toEqual({
                ok: false,
                reason: 'PanelSMS is not configured'
            });
            expect(fetch, missing).not.toHaveBeenCalled();
        }
    });
});

const SOAP_SETTINGS = { ...SETTINGS, apiUrl: 'https://webservice.example.test/service.asmx' };

/** What the web service really sends: a SOAP envelope with the one result in it. */
function soapAnswer(result: string): Response {
    return new Response(
        '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
            '<soap:Body><SendSMSResponse xmlns="http://tempuri.org/">' +
            `<SendSMSResult>${result}</SendSMSResult>` +
            '</SendSMSResponse></soap:Body></soap:Envelope>',
        { headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
    );
}

/** One field of the SendSMS call, read back through an XML parser's rules for entities. */
function field(envelope: string, name: string): string | undefined {
    const raw = new RegExp(`<${name}>([^<]*)</${name}>`).exec(envelope)?.[1];
    return raw
        ?.replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

describe('PanelSMS web service sender', () => {
    it('posts a SendSMS envelope with the five things the service asks for', async () => {
        const fetch = panel(() => soapAnswer('2'));
        const sms = createSms({
            settings: () => ({ ...SOAP_SETTINGS, password: 'p@ss&<word>' }),
            fetch
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledOnce();

        const [href, init] = fetch.mock.calls[0] as [string, RequestInit];
        expect(href).toBe(SOAP_SETTINGS.apiUrl);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: '"http://tempuri.org/SendSMS"'
        });

        const envelope = String(init.body);
        expect(envelope).toContain('<SendSMS xmlns="http://tempuri.org/">');
        // Escaped on the way in, so the `&` and `<` in the password do not break the envelope.
        expect(envelope).not.toContain('p@ss&<word>');
        expect(field(envelope, 'username')).toBe('shop-user');
        expect(field(envelope, 'password')).toBe('p@ss&<word>');
        expect(field(envelope, 'text')).toBe(
            'کد گیفت کارت شما\n\nNC-1234-5678\n\nفروشگاه اشبرینگر\n'
        );
        expect(field(envelope, 'mobileno')).toBe('09121234567');
        expect(field(envelope, 'pnlno')).toBe('30001234');
        // In the PHP sample, not in the WSDL.
        expect(envelope).not.toContain('isflash');
    });

    it('calls the service itself when the WSDL address is what was pasted', async () => {
        const fetch = panel(() => soapAnswer('2'));
        const sms = createSms({
            settings: () => ({ ...SOAP_SETTINGS, apiUrl: `${SOAP_SETTINGS.apiUrl}?wsdl` }),
            fetch
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });
        expect(fetch.mock.calls[0][0]).toBe(SOAP_SETTINGS.apiUrl);
    });

    it('counts nothing but 2 as sent - not the 0 the link page uses', async () => {
        for (const result of ['0', '', '   ', '1']) {
            const sms = createSms({
                settings: () => SOAP_SETTINGS,
                fetch: panel(() => soapAnswer(result))
            });

            expect((await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).ok, result).toBe(
                false
            );
        }
    });

    it('says what the code the service refused the message with means', async () => {
        for (const [result, reason] of [
            ['-3', 'PanelSMS returned code -3: username and password do not match'],
            ['-19', 'PanelSMS returned code -19: not enough panel credit'],
            ['Hang', 'PanelSMS returned code Hang: the account is blocked'],
            ['-99', 'PanelSMS returned code -99']
        ]) {
            const sms = createSms({
                settings: () => SOAP_SETTINGS,
                fetch: panel(() => soapAnswer(result))
            });

            expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
                ok: false,
                reason
            });
        }
    });

    it('does not pass on a SOAP fault, which can quote the request back', async () => {
        const sms = createSms({
            settings: () => SOAP_SETTINGS,
            fetch: panel(
                () =>
                    new Response(`<faultstring>bad request: ${SETTINGS.password}</faultstring>`, {
                        status: 500
                    })
            )
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS returned HTTP 500'
        });
    });

    it('does not read an answer with no result in it as sent', async () => {
        const sms = createSms({
            settings: () => SOAP_SETTINGS,
            fetch: panel(() => new Response('<html><body>خطا</body></html>'))
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS gave an unexpected response'
        });
    });

    it('keeps the password out of the reason when the service cannot be reached', async () => {
        const sms = createSms({
            settings: () => SOAP_SETTINGS,
            fetch: (_input, init) => Promise.reject(new Error(`failed: ${String(init?.body)}`))
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS is unreachable'
        });
    });

    it('does not ask for a domain, and asks for everything else', async () => {
        const fetch = panel(() => soapAnswer('2'));
        const sms = createSms({ settings: () => ({ ...SOAP_SETTINGS, domain: '' }), fetch });
        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });

        for (const missing of ['username', 'password', 'sender'] as const) {
            const unused = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
            const unset = createSms({
                settings: () => ({ ...SOAP_SETTINGS, [missing]: '' }),
                fetch: unused
            });

            expect(await unset.sendCode('+989121234567', 'NC-1234-5678', 10), missing).toEqual({
                ok: false,
                reason: 'PanelSMS is not configured'
            });
            expect(unused, missing).not.toHaveBeenCalled();
        }
    });
});
