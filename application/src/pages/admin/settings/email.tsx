// The English shop's delivery: Resend. The Persian shop texts its codes (./sms.tsx); the
// English one emails them, through this.
import { Mail, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function EmailSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [from, setFrom] = useState('');
    const [base, setBase] = useState('');
    const [testEmail, setTestEmail] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFrom(view.mailFrom);
            setBase(view.resendBase);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات ایمیل خوانده نشد'));
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
        try {
            const url = new URL(base);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                throw new Error('invalid protocol');
            }
        } catch {
            notify.error('آدرس API معتبر نیست');
            return;
        }

        setSaving(true);
        try {
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        mailFrom: from,
                        // No trailing slash: the client appends `/emails` itself.
                        resendBase: base.trim().replace(/\/+$/, ''),
                        resendApiKey: apiKey === '' ? undefined : apiKey
                    }
                })
            );
            setApiKey('');
            notify.success('تنظیمات ایمیل ذخیره شد');
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
            const result = await client.admin.testEmail({ input: { email: testEmail } });
            if (result.ok) {
                notify.success('ایمیل آزمایشی ارسال شد');
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
                <Mail className="size-5 text-firouze" aria-hidden="true" />
                ایمیل (Resend) - فروشگاه انگلیسی
            </h2>
            <p className="mt-2 text-small text-muted">
                در فروشگاه انگلیسی (/en) خریدار به‌جای موبایل ایمیل وارد می‌کند و کد پس از تأیید
                پرداخت با Resend به ایمیلش فرستاده می‌شود. آدرس فرستنده باید روی دامنه‌ای باشد که در
                Resend تأیید شده است.
            </p>

            <div className="mt-4">
                <Async
                    loading={loading || settings === null}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-48 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                                label="کلید API در Resend"
                                htmlFor="resend-api-key"
                                hint="پس از ذخیره نمایش داده نمی‌شود. برای نگه داشتن کلید فعلی، کادر را خالی بگذارید."
                            >
                                <TextInput
                                    id="resend-api-key"
                                    type="password"
                                    latin
                                    autoComplete="off"
                                    placeholder={
                                        settings?.resendApiKeySet
                                            ? `${settings.resendApiKeyMasked} (برای تغییر وارد کنید)`
                                            : 're_...'
                                    }
                                    value={apiKey}
                                    onChange={setApiKey}
                                />
                            </Field>
                            <Field
                                label="آدرس فرستنده (From)"
                                htmlFor="mail-from"
                                hint="مثلاً Shop <codes@example.com>"
                            >
                                <TextInput
                                    id="mail-from"
                                    latin
                                    autoComplete="off"
                                    placeholder="codes@example.com"
                                    value={from}
                                    onChange={setFrom}
                                />
                            </Field>
                            <Field
                                label="آدرس API"
                                htmlFor="resend-base"
                                hint="اگر api.resend.com از سرور در دسترس نیست، آدرس یک رله را اینجا بگذارید."
                            >
                                <TextInput
                                    id="resend-base"
                                    latin
                                    inputMode="url"
                                    autoComplete="off"
                                    placeholder="https://api.resend.com"
                                    value={base}
                                    onChange={setBase}
                                />
                            </Field>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button type="submit" glyph={Save} disabled={saving}>
                                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات ایمیل'}
                            </Button>
                            <span className="text-caption text-muted">
                                وضعیت: {settings?.mailReady ? 'آماده' : 'خاموش'}
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
                        یک ایمیل آزمایشی با کد ساختگی به آدرس واردشده می‌فرستد.
                    </p>
                    <div className="mt-4 flex flex-wrap items-end gap-3">
                        <Field label="ایمیل آزمایشی" htmlFor="test-email">
                            <TextInput
                                id="test-email"
                                type="email"
                                latin
                                inputMode="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                value={testEmail}
                                onChange={setTestEmail}
                            />
                        </Field>
                        <Button
                            type="submit"
                            glyph={Send}
                            disabled={testing || testEmail.trim() === ''}
                        >
                            {testing ? 'در حال ارسال…' : 'ارسال ایمیل آزمایشی'}
                        </Button>
                    </div>
                </form>
            </div>
        </section>
    );
}
