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
            TEXT: 'کد گیفت کارت 10 دلاری اشبرینگر: NC-1234-5678',
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
