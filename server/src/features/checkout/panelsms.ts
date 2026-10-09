import type { Fetch } from './zarinpal.ts';

export interface SmsSettings {
    apiUrl: string;
    apiKey: string;
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
            if (live.apiUrl === '' || live.apiKey === '' || live.sender === '') {
                return { ok: false, reason: 'PanelSMS is not configured' };
            }

            try {
                const response = await call(live.apiUrl, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${live.apiKey}`,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: live.sender,
                        to: phone,
                        message: `کد گیفت کارت ${amountUsd} دلاری ${live.appName}: ${code}`
                    }),
                    signal: AbortSignal.timeout(timeoutMs)
                });
                if (!response.ok) {
                    return { ok: false, reason: `PanelSMS returned HTTP ${response.status}` };
                }
                return { ok: true };
            } catch {
                return { ok: false, reason: 'PanelSMS is unreachable' };
            }
        }
    };
}
