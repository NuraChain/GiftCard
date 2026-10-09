import { MessageSquare, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function SmsSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [apiUrl, setApiUrl] = useState('');
    const [sender, setSender] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [testPhone, setTestPhone] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setApiUrl(view.smsApiUrl);
            setSender(view.smsSender);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات پیامک خوانده نشد'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (session.unlocked) {
            void load();
        }
    }, [session.revision, session.unlocked, load]);

    const save = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (settings === null) {
            notify.error('تنظیمات هنوز خوانده نشده است. صفحه را تازه کنید.');
            return;
        }
        if (apiUrl.trim() !== '') {
            try {
                const url = new URL(apiUrl);
                if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                    throw new Error('invalid protocol');
                }
            } catch {
                notify.error('آدرس API معتبر نیست');
                return;
            }
        }

        setSaving(true);
        try {
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        smsApiUrl: apiUrl,
                        smsSender: sender,
                        smsApiKey: apiKey === '' ? undefined : apiKey
                    }
                })
            );
            setApiKey('');
            notify.success('تنظیمات پیامک ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setTesting(true);
        try {
            const result = await client.admin.testSms({ input: { phone: testPhone } });
            if (result.ok) {
                notify.success('پیامک آزمایشی ارسال شد');
            } else {
                notify.error(`ارسال نشد: ${result.reason}`);
            }
        } catch (failure) {
            notify.error(failureText(failure, 'ارسال نشد'));
        } finally {
            setTesting(false);
        }
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <MessageSquare className="size-5 text-firouze" aria-hidden="true" />
                پنل پیامک
            </h2>
            <p className="mt-2 text-small text-muted">
                پس از تأیید پرداخت، کد خرید به شماره موبایل خریدار پیامک می‌شود. درخواست با روش REST،
                هدر Bearer و بدنهٔ JSON شامل from، to و message ارسال می‌شود.
            </p>

            <div className="mt-4">
                <Async
                    loading={loading || settings === null}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                                label="آدرس کامل API ارسال"
                                htmlFor="sms-api-url"
                                hint="آدرس کامل endpoint ارسال پیامک را از پنل سرویس وارد کنید."
                            >
                                <TextInput
                                    id="sms-api-url"
                                    latin
                                    inputMode="url"
                                    autoComplete="url"
                                    placeholder="https://api.example.com/sms/send"
                                    value={apiUrl}
                                    onChange={setApiUrl}
                                />
                            </Field>
                            <Field label="شماره فرستنده" htmlFor="sms-sender">
                                <TextInput
                                    id="sms-sender"
                                    latin
                                    autoComplete="off"
                                    placeholder="شماره یا خط ارسال پنل"
                                    value={sender}
                                    onChange={setSender}
                                />
                            </Field>
                        </div>
                        <Field
                            label="کلید API پنل پیامک"
                            htmlFor="sms-api-key"
                            hint="پس از ذخیره نمایش داده نمی‌شود. برای نگه داشتن کلید فعلی، کادر را خالی بگذارید."
                        >
                            <TextInput
                                id="sms-api-key"
                                type="password"
                                latin
                                autoComplete="off"
                                placeholder={
                                    settings?.smsApiKeySet
                                        ? `${settings.smsApiKeyMasked} (برای تغییر وارد کنید)`
                                        : 'کلید API'
                                }
                                value={apiKey}
                                onChange={setApiKey}
                            />
                        </Field>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button type="submit" glyph={Save} disabled={saving}>
                                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات پیامک'}
                            </Button>
                            <span className="text-caption text-muted">
                                وضعیت: {settings?.smsReady ? 'آماده' : 'خاموش'}
                            </span>
                        </div>
                    </form>
                </Async>

                <form
                    className="mt-4 rounded-2xl border border-line bg-surface p-5"
                    noValidate
                    onSubmit={(event) => void sendTest(event)}
                >
                    <h3 className="font-bold">آزمایش ارسال</h3>
                    <p className="mt-1 text-caption text-muted">
                        برای اطمینان از تنظیمات، یک پیامک آزمایشی به شماره واردشده می‌فرستد.
                    </p>
                    <div className="mt-4 flex flex-wrap items-end gap-3">
                        <Field label="شماره موبایل آزمایشی" htmlFor="test-sms-phone">
                            <TextInput
                                id="test-sms-phone"
                                type="tel"
                                latin
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="09123456789"
                                value={testPhone}
                                onChange={setTestPhone}
                            />
                        </Field>
                        <Button
                            type="submit"
                            glyph={Send}
                            disabled={testing || testPhone.trim() === ''}
                        >
                            {testing ? 'در حال ارسال…' : 'ارسال پیامک آزمایشی'}
                        </Button>
                    </div>
                </form>
            </div>
        </section>
    );
}
