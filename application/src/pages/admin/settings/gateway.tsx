// Where the money goes and how the code gets delivered: the payment gateway and the mail
// server, both editable without a deploy.
//
// A SECRET IS NEVER SHOWN. The inputs start empty with a masked placeholder, and leaving one
// blank means "keep it" - so saving a host name cannot wipe a working password. The server
// enforces that too; this component only has to not fight it.
//
// The merchant id is the one field on the page that changes WHERE THE MONEY GOES, so it is
// the one field that asks a second question before saving.
//
// SMTP RATHER THAN AN SMS PROVIDER. Codes used to be texted through Kavenegar; they are
// emailed now, and the settings that replaced the API key are the ones any mail account has -
// a host, a port, a login and a From address. The From is called out in its own hint because
// it is the field that silently breaks delivery: most relays refuse to send as an address
// that is not the account they authenticated.
import { AlertTriangle, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import { useCatalog } from '../../../lib/catalog.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function GatewaySettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const catalog = useCatalog();

    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Secrets start EMPTY, not pre-filled with the stored value: there is no stored value to
    // pre-fill with, because the server never sends one. Blank means "unchanged".
    const [formAppName, setFormAppName] = useState('');
    const [formBase, setFormBase] = useState('');
    const [formMerchantId, setFormMerchantId] = useState('');
    const [formSmtpHost, setFormSmtpHost] = useState('');
    const [formSmtpPort, setFormSmtpPort] = useState('');
    const [formSmtpSecure, setFormSmtpSecure] = useState(false);
    const [formSmtpUser, setFormSmtpUser] = useState('');
    const [formSmtpPassword, setFormSmtpPassword] = useState('');
    const [formSmtpFrom, setFormSmtpFrom] = useState('');
    const [saving, setSaving] = useState(false);

    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormAppName(view.appName);
            setFormBase(view.zarinpalBase);
            setFormSmtpHost(view.smtpHost);
            setFormSmtpPort(String(view.smtpPort));
            setFormSmtpSecure(view.smtpSecure);
            setFormSmtpUser(view.smtpUser);
            setFormSmtpFrom(view.smtpFrom);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات خوانده نشد'));
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
        // Changing the merchant id changes WHERE THE MONEY GOES. It is the one field on this
        // page that deserves a second question.
        if (
            formMerchantId !== '' &&
            !confirm('شناسهٔ پذیرنده عوض می‌شود. از این پس پرداخت‌ها به حساب تازه می‌رود. مطمئنید؟')
        ) {
            return;
        }
        setSaving(true);
        try {
            // Absent, not empty: an untouched secret input must not clear a working
            // credential, so a blank field is simply not sent.
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        appName: formAppName,
                        zarinpalBase: formBase,
                        smtpHost: formSmtpHost,
                        smtpPort: port,
                        smtpSecure: formSmtpSecure,
                        smtpUser: formSmtpUser,
                        smtpFrom: formSmtpFrom,
                        merchantId: formMerchantId === '' ? undefined : formMerchantId,
                        smtpPassword: formSmtpPassword === '' ? undefined : formSmtpPassword
                    }
                })
            );
            setFormMerchantId('');
            setFormSmtpPassword('');
            // The name appears in the tab title and on every page, so the shop is told to
            // re-read it rather than left showing the old one until a reload.
            void catalog.load();
            notify.success('تنظیمات ذخیره شد');
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
            <h2 className="text-h3 font-bold">درگاه و ایمیل</h2>

            <div className="mt-4">
                <Async
                    loading={loading && settings === null}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <p className="mb-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-4 text-small">
                        <AlertTriangle className="size-5 shrink-0 text-gold" aria-hidden="true" />
                        <span>
                            تغییر شناسهٔ پذیرنده مقصد پول را عوض می‌کند. مقادیر محرمانه پس از ذخیره
                            دیگر نمایش داده نمی‌شوند؛ برای نگه داشتن مقدار فعلی، کادر را خالی
                            بگذارید.
                        </span>
                    </p>

                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <Field
                            label="نام فروشگاه"
                            htmlFor="app-name"
                            hint="روی عنوان مرورگر، سربرگ صفحه‌ها، پانویس، موضوع ایمیل کد، و توضیح تراکنش در درگاه دیده می‌شود."
                        >
                            <TextInput
                                id="app-name"
                                placeholder="گاردین سرویس"
                                value={formAppName}
                                onChange={setFormAppName}
                            />
                        </Field>

                        <Field label="آدرس درگاه" htmlFor="zarinpal-base" className="mt-4">
                            <TextInput
                                id="zarinpal-base"
                                latin
                                value={formBase}
                                onChange={setFormBase}
                            />
                        </Field>
                        <p className="mt-1 text-caption text-muted">
                            {settings?.sandbox === true ? (
                                <span className="text-gold">
                                    حالت آزمایشی (سندباکس) - پولی جابه‌جا نمی‌شود.
                                </span>
                            ) : (
                                <span>درگاه واقعی. پرداخت‌ها با پول واقعی انجام می‌شود.</span>
                            )}
                        </p>

                        <Field label="شناسهٔ پذیرنده" htmlFor="merchant-id" className="mt-4">
                            <TextInput
                                id="merchant-id"
                                latin
                                autoComplete="off"
                                placeholder={
                                    settings?.merchantIdSet === true
                                        ? `${settings.merchantIdMasked} (برای تغییر بنویسید)`
                                        : 'تنظیم نشده'
                                }
                                value={formMerchantId}
                                onChange={setFormMerchantId}
                            />
                        </Field>

                        <h3 className="mt-6 border-t border-line pt-5 font-bold">
                            سرور ایمیل (SMTP)
                        </h3>

                        <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
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

                        {/* A flex child defaults to `min-width: auto`, so an unbreakable
                            value refuses to shrink and pushes the row past the viewport -
                            which is exactly what this URL did. `min-w-0` is what lets it
                            shrink at all; `break-all` is what it does once it can. */}
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
                            <div className="flex justify-between gap-2">
                                <dt className="shrink-0">آدرس بازگشت از درگاه</dt>
                                <dd dir="ltr" className="latin min-w-0 break-all text-end">
                                    {settings?.callbackUrl ?? ''}
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
                            ذخیره تنظیمات
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
