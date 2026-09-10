// Where the money goes and how the code gets delivered: the payment gateway and the SMS
// provider, both editable without a deploy.
//
// A SECRET IS NEVER SHOWN. The inputs start empty with a masked placeholder, and leaving one
// blank means "keep it" - so saving a template name cannot wipe a working API key. The
// server enforces that too; this component only has to not fight it.
//
// The merchant id is the one field on the page that changes WHERE THE MONEY GOES, so it is
// the one field that asks a second question before saving.
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
    const [formKavenegarKey, setFormKavenegarKey] = useState('');
    const [formKavenegarTemplate, setFormKavenegarTemplate] = useState('');
    const [formKavenegarBase, setFormKavenegarBase] = useState('');
    const [saving, setSaving] = useState(false);

    const [testPhone, setTestPhone] = useState('');
    const [testing, setTesting] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormAppName(view.appName);
            setFormBase(view.zarinpalBase);
            setFormKavenegarTemplate(view.kavenegarTemplate);
            setFormKavenegarBase(view.kavenegarBase);
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
                        kavenegarTemplate: formKavenegarTemplate,
                        kavenegarBase: formKavenegarBase,
                        merchantId: formMerchantId === '' ? undefined : formMerchantId,
                        kavenegarKey: formKavenegarKey === '' ? undefined : formKavenegarKey
                    }
                })
            );
            setFormMerchantId('');
            setFormKavenegarKey('');
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
            <h2 className="text-h3 font-bold">درگاه و پیامک</h2>

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
                            hint="روی عنوان مرورگر، سربرگ صفحه‌ها، پانویس، و توضیح تراکنش در درگاه دیده می‌شود."
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

                        <Field label="کلید کاوه‌نگار" htmlFor="kavenegar-key" className="mt-4">
                            <TextInput
                                id="kavenegar-key"
                                type="password"
                                latin
                                autoComplete="off"
                                placeholder={
                                    settings?.kavenegarKeySet === true
                                        ? `${settings.kavenegarKeyMasked} (برای تغییر بنویسید)`
                                        : 'تنظیم نشده'
                                }
                                value={formKavenegarKey}
                                onChange={setFormKavenegarKey}
                            />
                        </Field>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <Field label="نام قالب" htmlFor="kavenegar-template">
                                <TextInput
                                    id="kavenegar-template"
                                    latin
                                    value={formKavenegarTemplate}
                                    onChange={setFormKavenegarTemplate}
                                />
                            </Field>
                            <Field label="آدرس کاوه‌نگار" htmlFor="kavenegar-base">
                                <TextInput
                                    id="kavenegar-base"
                                    latin
                                    value={formKavenegarBase}
                                    onChange={setFormKavenegarBase}
                                />
                            </Field>
                        </div>

                        {/* A flex child defaults to `min-width: auto`, so an unbreakable
                            value refuses to shrink and pushes the row past the viewport -
                            which is exactly what this URL did. `min-w-0` is what lets it
                            shrink at all; `break-all` is what it does once it can. */}
                        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت پیامک</dt>
                                <dd
                                    className={
                                        settings?.smsReady === true
                                            ? 'font-bold text-firouze'
                                            : 'font-bold text-gold'
                                    }
                                >
                                    {settings?.smsReady === true ? 'آماده' : 'خاموش'}
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

                    {/* The only way to prove a Kavenegar template is approved without selling
                        something first. It sends an obviously-fake token, never a real code. */}
                    <form
                        className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void sendTest(event)}
                    >
                        <Field
                            label="پیامک آزمایشی به"
                            htmlFor="test-phone"
                            className="min-w-0 flex-1"
                        >
                            <TextInput
                                id="test-phone"
                                type="tel"
                                latin
                                inputMode="tel"
                                placeholder="09170459330"
                                value={testPhone}
                                onChange={setTestPhone}
                            />
                        </Field>
                        <Button
                            type="submit"
                            glyph={Send}
                            busy={testing}
                            busyText="در حال ارسال..."
                            disabled={testPhone === ''}
                        >
                            ارسال
                        </Button>
                    </form>
                </Async>
            </div>
        </section>
    );
}
