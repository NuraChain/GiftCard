// How the gift code reaches the buyer: Resend, and nothing else.
//
// THIS PANEL USED TO SHARE A FORM WITH THE GATEWAY. They are apart because they fail apart: a
// broken mail key stops delivery and a wrong merchant id sends takings to a stranger, and an
// operator fixing one should never be editing a form that can save the other. This panel sends
// ONLY its own fields, and the server treats an absent field as unchanged.
//
// RESEND RATHER THAN SMTP. It used to be a host, a port, a TLS checkbox, a username and a
// password - five boxes to get right before one message moved. It is now a key and a From
// address. See server: features/checkout/mailer.ts.
//
// THE TWO THINGS THAT ACTUALLY GO WRONG, both called out in the hints rather than left for the
// operator to discover through a buyer who paid and got nothing:
//   - the From address must be on a domain VERIFIED in Resend. `onboarding@resend.dev` works
//     without one, but only ever delivers to the inbox that owns the Resend account, so it
//     proves the wiring and nothing else.
//   - `api.resend.com` may not be reachable from where this is hosted, which is why the host
//     is a field at all.
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

    const [formFrom, setFormFrom] = useState('');
    const [formBase, setFormBase] = useState('');

    // The secret starts EMPTY, not pre-filled with the stored value: there is no stored value
    // to pre-fill with, because the server never sends one. Blank means "unchanged".
    const [formApiKey, setFormApiKey] = useState('');

    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormFrom(view.mailFrom);
            setFormBase(view.resendBase);
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
        // NOTHING IS SAVED BEFORE SOMETHING IS READ. Every field below is posted whether or
        // not it was touched, so submitting a form that never loaded would write the empty
        // boxes it is showing over whatever is actually stored. `settings` is null until a
        // read succeeds, which makes that state unreachable rather than merely unlikely.
        if (settings === null) {
            notify.error('تنظیمات هنوز خوانده نشده است. صفحه را تازه کنید.');
            return;
        }

        // An empty From is not a way to turn delivery off - it is an unfinished form. Saving
        // it would clear a working address and leave the shop silently not sending.
        if (formFrom.trim() === '') {
            notify.error('آدرس فرستنده را وارد کنید');
            return;
        }
        if (formBase.trim() === '') {
            notify.error('آدرس API را وارد کنید');
            return;
        }

        setSaving(true);
        try {
            // Absent, not empty: an untouched key input must not clear a working credential,
            // so a blank field is simply not sent.
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        mailFrom: formFrom,
                        resendBase: formBase,
                        resendApiKey: formApiKey === '' ? undefined : formApiKey
                    }
                })
            );
            setFormApiKey('');
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
                کد گیفت کارت با سرویس Resend برای خریدار فرستاده می‌شود. تا وقتی کلید و آدرس فرستنده
                تنظیم نشده باشد، کد فقط روی صفحه نشان داده می‌شود.
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
                        <Field
                            label="کلید Resend"
                            htmlFor="resend-api-key"
                            hint="از بخش API Keys داشبورد Resend. بعد از ذخیره دیگر نمایش داده نمی‌شود؛ برای نگه داشتن مقدار فعلی، کادر را خالی بگذارید."
                        >
                            <TextInput
                                id="resend-api-key"
                                type="password"
                                latin
                                autoComplete="off"
                                placeholder={
                                    settings?.resendApiKeySet === true
                                        ? `${settings.resendApiKeyMasked} (برای تغییر بنویسید)`
                                        : 're_...'
                                }
                                value={formApiKey}
                                onChange={setFormApiKey}
                            />
                        </Field>

                        <Field
                            label="فرستنده"
                            htmlFor="mail-from"
                            className="mt-4"
                            hint="باید روی دامنه‌ای باشد که در Resend تأیید کرده‌اید. onboarding@resend.dev بدون تأیید کار می‌کند ولی فقط به ایمیل صاحب حساب Resend می‌رسد، نه به خریدارها."
                        >
                            <TextInput
                                id="mail-from"
                                latin
                                placeholder="AshBringer <no-reply@example.com>"
                                value={formFrom}
                                onChange={setFormFrom}
                            />
                        </Field>

                        <Field
                            label="آدرس API"
                            htmlFor="resend-base"
                            className="mt-4"
                            hint="اگر api.resend.com از سرور شما در دسترس نیست، آدرس واسط را اینجا بگذارید."
                        >
                            <TextInput
                                id="resend-base"
                                latin
                                value={formBase}
                                onChange={setFormBase}
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
