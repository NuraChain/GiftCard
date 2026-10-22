// The English shop's gateway: NOWPayments. It is apart from ./gateway.tsx because it is not a
// CHOICE - the Persian shop is paid through whichever of Zarinpal and Zibal is selected
// there, and the English shop is always paid through NOWPayments, whatever that choice is.
import { Bitcoin, PlugZap, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

export default function NowPaymentsSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [base, setBase] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setBase(view.nowPaymentsBase);
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات NOWPayments خوانده نشد'));
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
                        nowPaymentsBase: base.trim().replace(/\/+$/, ''),
                        nowPaymentsApiKey: apiKey === '' ? undefined : apiKey
                    }
                })
            );
            setApiKey('');
            notify.success('تنظیمات NOWPayments ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    const runTest = async (): Promise<void> => {
        setTesting(true);
        try {
            const result = await client.admin.testNowPayments();
            if (result.ok) {
                notify.success('NOWPayments فاکتور آزمایشی را باز کرد. کلید درست کار می‌کند.');
            } else {
                notify.error(`NOWPayments فاکتور را باز نکرد: ${result.reason}`);
            }
        } catch (failure) {
            notify.error(failureText(failure, 'آزمایش انجام نشد'));
        } finally {
            setTesting(false);
        }
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Bitcoin className="size-5 text-firouze" aria-hidden="true" />
                درگاه NOWPayments - فروشگاه انگلیسی
            </h2>
            <p className="mt-2 text-small text-muted">
                خرید در فروشگاه انگلیسی (/en) همیشه با NOWPayments و به ارز دیجیتال پرداخت می‌شود، با
                قیمت اسمی کارت به دلار (کارت ۱۰ دلاری = ۱۰ دلار). تا کلید وارد نشود، کارت‌های انگلیسی
                قابل خرید نیستند.
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
                                label="API key"
                                htmlFor="nowpayments-api-key"
                                hint="از پنل NOWPayments، بخش Settings ← Payments ← Payment details. پس از ذخیره نمایش داده نمی‌شود؛ برای نگه داشتن کلید فعلی، کادر را خالی بگذارید."
                            >
                                <TextInput
                                    id="nowpayments-api-key"
                                    type="password"
                                    latin
                                    autoComplete="off"
                                    placeholder={
                                        settings?.nowPaymentsApiKeySet
                                            ? `${settings.nowPaymentsApiKeyMasked} (برای تغییر وارد کنید)`
                                            : 'API key'
                                    }
                                    value={apiKey}
                                    onChange={setApiKey}
                                />
                            </Field>
                            <Field label="آدرس API" htmlFor="nowpayments-base">
                                <TextInput
                                    id="nowpayments-base"
                                    latin
                                    inputMode="url"
                                    autoComplete="off"
                                    placeholder="https://api.nowpayments.io"
                                    value={base}
                                    onChange={setBase}
                                />
                            </Field>
                        </div>

                        <dl className="mt-4 grid gap-1 text-caption text-muted">
                            <dt>
                                آدرس IPN (هر فاکتور آن را با خود می‌برد؛ وارد کردنش در پنل لازم نیست):
                            </dt>
                            <dd dir="ltr" className="latin min-w-0 break-all text-start">
                                {settings?.nowPaymentsCallbackUrl}
                            </dd>
                        </dl>
                        <p className="mt-3 text-caption text-muted">
                            در پنل NOWPayments یک IPN secret بسازید (Settings ← Payments ← Instant
                            payment notifications) تا اعلان پرداخت‌ها ارسال شود. اگر سرور فایروال
                            دارد، IPهای NOWPayments را مجاز کنید: 51.89.194.21، 51.75.77.69،
                            138.201.172.58، 65.21.158.36.
                        </p>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Button type="submit" glyph={Save} disabled={saving}>
                                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات NOWPayments'}
                            </Button>
                            <Button
                                glyph={PlugZap}
                                disabled={testing || settings?.nowPaymentsApiKeySet !== true}
                                onClick={() => void runTest()}
                            >
                                {testing ? 'در حال آزمایش…' : 'آزمایش درگاه'}
                            </Button>
                            <span className="text-caption text-muted">
                                وضعیت: {settings?.nowPaymentsApiKeySet ? 'فعال' : 'خاموش'}
                            </span>
                        </div>
                    </form>
                </Async>
            </div>
        </section>
    );
}
