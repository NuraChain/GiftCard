// How the gift code reaches the buyer: the mail server, and nothing else.
//
// THIS PANEL USED TO SHARE A FORM WITH THE GATEWAY. They are apart now because they fail
// apart: a broken SMTP password stops delivery and a wrong merchant id sends takings to a
// stranger, and an operator fixing one should never be editing a form that can save the
// other. This panel sends ONLY its own fields, and the server treats an absent field as
// unchanged, so saving here cannot disturb the payment settings even by accident.
//
// SMTP RATHER THAN AN SMS PROVIDER. Codes used to be texted through Kavenegar; they are
// emailed now, and the settings that replaced the API key are the ones any mail account has -
// a host, a port, a login and a From address. The From is called out in its own hint because
// it is the field that silently breaks delivery: most relays refuse to send as an address
// that is not the account they authenticated.
//
// THE TEST SEND IS THE POINT OF THE PANEL. Mail settings are the kind that look right and are
// wrong, and the alternative way to find out is a buyer who paid and got nothing - so there is
// a button here that proves the whole path with an obviously-fake code.
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

    const [formSmtpHost, setFormSmtpHost] = useState('');
    const [formSmtpPort, setFormSmtpPort] = useState('');
    const [formSmtpSecure, setFormSmtpSecure] = useState(false);
    const [formSmtpUser, setFormSmtpUser] = useState('');
    const [formSmtpFrom, setFormSmtpFrom] = useState('');

    // The secret starts EMPTY, not pre-filled with the stored value: there is no stored value
    // to pre-fill with, because the server never sends one. Blank means "unchanged".
    const [formSmtpPassword, setFormSmtpPassword] = useState('');

    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormSmtpHost(view.smtpHost);
            setFormSmtpPort(String(view.smtpPort));
            setFormSmtpSecure(view.smtpSecure);
            setFormSmtpUser(view.smtpUser);
            setFormSmtpFrom(view.smtpFrom);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات ایمیل خوانده نشد'));
        } finally {
            setLoading(false);
        }
    }, []);

    // Keyed on the session, not on mount - see the note in overview.tsx.
    useEffect(() => {
        if (session.unlocked) {
            void load();
        }
    }, [session.revision, session.unlocked, load]);

    const save = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const port = Number(formSmtpPort);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
            notify.error('پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد');
            return;
        }
        setSaving(true);
        try {
            // Absent, not empty: an untouched password input must not clear a working
            // credential, so a blank field is simply not sent.
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        smtpHost: formSmtpHost,
                        smtpPort: port,
                        smtpSecure: formSmtpSecure,
                        smtpUser: formSmtpUser,
                        smtpFrom: formSmtpFrom,
                        smtpPassword: formSmtpPassword === '' ? undefined : formSmtpPassword
                    }
                })
            );
            setFormSmtpPassword('');
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
                ایمیل
            </h2>
            <p className="mt-2 text-small text-muted">
                کد گیفت کارت از همین سرور برای خریدار فرستاده می‌شود. تا وقتی آدرس سرور و فرستنده
                تنظیم نشده باشد، کد فقط روی صفحه نشان داده می‌شود.
            </p>

            <div className="mt-4">
                <Async
                    loading={loading && settings === null}
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
                        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                            <Field label="آدرس سرور" htmlFor="smtp-host">
                                <TextInput
                                    id="smtp-host"
                                    latin
                                    placeholder="smtp.example.com"
                                    value={formSmtpHost}
                                    onChange={setFormSmtpHost}
                                />
                            </Field>
                            <Field label="پورت" htmlFor="smtp-port">
                                <TextInput
                                    id="smtp-port"
                                    type="number"
                                    latin
                                    value={formSmtpPort}
                                    onChange={setFormSmtpPort}
                                />
                            </Field>
                        </div>

                        <label className="mt-4 flex items-center gap-2 text-small">
                            <input
                                type="checkbox"
                                checked={formSmtpSecure}
                                onChange={(event) => setFormSmtpSecure(event.target.checked)}
                            />
                            اتصال امن مستقیم (SSL/TLS) - معمولاً برای پورت ۴۶۵
                        </label>
                        <p className="mt-1 text-caption text-muted">
                            برای پورت ۵۸۷ این را خاموش بگذارید؛ اتصال با STARTTLS امن می‌شود.
                        </p>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <Field label="نام کاربری" htmlFor="smtp-user">
                                <TextInput
                                    id="smtp-user"
                                    latin
                                    autoComplete="off"
                                    value={formSmtpUser}
                                    onChange={setFormSmtpUser}
                                />
                            </Field>
                            <Field label="رمز عبور" htmlFor="smtp-password">
                                <TextInput
                                    id="smtp-password"
                                    type="password"
                                    latin
                                    autoComplete="off"
                                    placeholder={
                                        settings?.smtpPasswordSet === true
                                            ? `${settings.smtpPasswordMasked} (برای تغییر بنویسید)`
                                            : 'تنظیم نشده'
                                    }
                                    value={formSmtpPassword}
                                    onChange={setFormSmtpPassword}
                                />
                            </Field>
                        </div>

                        <Field
                            label="فرستنده"
                            htmlFor="smtp-from"
                            className="mt-4"
                            hint="بیشتر سرورها فقط اجازه می‌دهند از آدرس همان حسابی که با آن وارد شده‌اید ایمیل بفرستید."
                        >
                            <TextInput
                                id="smtp-from"
                                latin
                                placeholder="Guardian Service <no-reply@example.com>"
                                value={formSmtpFrom}
                                onChange={setFormSmtpFrom}
                            />
                        </Field>

                        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت ایمیل</dt>
                                <dd
                                    className={
                                        settings?.mailReady === true
                                            ? 'font-bold text-firouze'
                                            : 'font-bold text-gold'
                                    }
                                >
                                    {settings?.mailReady === true ? 'آماده' : 'خاموش'}
                                </dd>
                            </div>
                        </dl>

                        <Button
                            type="submit"
                            variant="primary"
                            glyph={Save}
                            className="mt-5"
                            busy={saving}
                            busyText="در حال ذخیره..."
                        >
                            ذخیره ایمیل
                        </Button>
                    </form>

                    {/* The only way to prove the mail settings work without selling something
                        first. It sends an obviously-fake code, never a real one. */}
                    <form
                        className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void sendTest(event)}
                    >
                        <Field
                            label="ایمیل آزمایشی به"
                            htmlFor="test-email"
                            className="min-w-0 flex-1"
                        >
                            <TextInput
                                id="test-email"
                                type="email"
                                latin
                                inputMode="email"
                                placeholder="name@example.com"
                                value={testEmail}
                                onChange={setTestEmail}
                            />
                        </Field>
                        <Button
                            type="submit"
                            glyph={Send}
                            busy={testing}
                            busyText="در حال ارسال..."
                            disabled={testEmail === ''}
                        >
                            ارسال
                        </Button>
                    </form>
                </Async>
            </div>
        </section>
    );
}
