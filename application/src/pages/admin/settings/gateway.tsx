// Where the money goes: the Zarinpal gateway, and nothing else.
//
// THIS PANEL USED TO CARRY THE MAIL SERVER TOO. They are apart now because they fail apart:
// a broken mail key stops delivery and a wrong merchant id sends takings to a stranger,
// and an operator fixing one should never be editing a form that can save the other. Each
// panel sends ONLY its own fields, and the server treats an absent field as unchanged, so
// saving here cannot disturb the mail settings even by accident.
//
// THE PUBLIC ORIGIN IS HERE because it is a gateway fact, not a deployment one: it is the
// address Zarinpal sends the buyer back to, and getting it wrong strands every payment on the
// bank's page with the money taken and no code delivered. It used to be an environment
// variable, which meant the only way to fix that was a deploy - at exactly the moment an
// operator can least afford one. The callback URL below is derived from it and shown in full,
// because that is the string Zarinpal's own panel wants pasted into it.
//
// A SECRET IS NEVER SHOWN. The merchant id input starts empty with a masked placeholder, and
// leaving it blank means "keep it" - so saving a host name cannot wipe a working credential.
// The server enforces that too; this component only has to not fight it.
//
// The merchant id is the one field in the console that changes WHERE THE MONEY GOES, so it is
// the one field that asks a second question before saving.
import { AlertTriangle, CreditCard, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function GatewaySettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [formPublicBase, setFormPublicBase] = useState('');
    const [formBase, setFormBase] = useState('');

    // The secret starts EMPTY, not pre-filled with the stored value: there is no stored value
    // to pre-fill with, because the server never sends one. Blank means "unchanged".
    const [formMerchantId, setFormMerchantId] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormPublicBase(view.publicBaseUrl);
            setFormBase(view.zarinpalBase);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات درگاه خوانده نشد'));
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
        // Changing the merchant id changes WHERE THE MONEY GOES. It is the one field in this
        // console that deserves a second question.
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
                        publicBaseUrl: formPublicBase,
                        zarinpalBase: formBase,
                        merchantId: formMerchantId === '' ? undefined : formMerchantId
                    }
                })
            );
            setFormMerchantId('');
            notify.success('تنظیمات درگاه ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <CreditCard className="size-5 text-firouze" aria-hidden="true" />
                درگاه پرداخت
            </h2>

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
                            تغییر شناسهٔ پذیرنده مقصد پول را عوض می‌کند. این مقدار پس از ذخیره دیگر
                            نمایش داده نمی‌شود؛ برای نگه داشتن مقدار فعلی، کادر را خالی بگذارید.
                        </span>
                    </p>

                    <form
                        className="rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <Field
                            label="آدرس عمومی فروشگاه"
                            htmlFor="public-base-url"
                            hint="آدرسی که خریدار با آن وارد سایت می‌شود. زرین‌پال خریدار را به همین آدرس برمی‌گرداند، پس اگر اشتباه باشد پرداخت‌ها نیمه‌کاره می‌مانند."
                        >
                            <TextInput
                                id="public-base-url"
                                latin
                                placeholder="https://example.com"
                                value={formPublicBase}
                                onChange={setFormPublicBase}
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

                        {/* A flex child defaults to `min-width: auto`, so an unbreakable
                            value refuses to shrink and pushes the row past the viewport -
                            which is exactly what this URL did. `min-w-0` is what lets it
                            shrink at all; `break-all` is what it does once it can. */}
                        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت درگاه</dt>
                                <dd
                                    className={
                                        settings?.merchantIdSet === true
                                            ? 'font-bold text-firouze'
                                            : 'font-bold text-gold'
                                    }
                                >
                                    {settings?.merchantIdSet === true ? 'آماده' : 'تنظیم نشده'}
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
                            ذخیره درگاه
                        </Button>
                    </form>
                </Async>
            </div>
        </section>
    );
}
