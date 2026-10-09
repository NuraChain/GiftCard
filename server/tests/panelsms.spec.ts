import { describe, expect, it, vi } from 'vitest';

import { createSms } from '../src/features/checkout/panelsms.ts';

const SETTINGS = {
    apiUrl: 'https://sms.example.test/v1/send',
    apiKey: 'secret-token',
    sender: '30001234',
    appName: 'اشبرینگر'
};

describe('PanelSMS sender', () => {
    it('posts the sender, recipient, and purchase code to the configured API', async () => {
        const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
            (_input, _init) =>
                Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
        );
        const sms = createSms({ settings: () => SETTINGS, fetch });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(SETTINGS.apiUrl);
        expect(init.method).toBe('POST');
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-token');
        expect(JSON.parse(String(init.body))).toEqual({
            from: SETTINGS.sender,
            to: '+989121234567',
            message: 'کد گیفت کارت 10 دلاری اشبرینگر: NC-1234-5678'
        });
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

    it('does not make a network request until all settings are configured', async () => {
        const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
        const sms = createSms({
            settings: () => ({ ...SETTINGS, apiKey: '' }),
            fetch
        });

        expect(await sms.sendCode('+989121234567', 'NC-1234-5678', 10)).toEqual({
            ok: false,
            reason: 'PanelSMS is not configured'
        });
        expect(fetch).not.toHaveBeenCalled();
    });
});
