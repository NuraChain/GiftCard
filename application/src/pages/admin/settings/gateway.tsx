// Where the money goes: the payment gateways, and nothing else.
//
// THERE ARE TWO NOW - Zarinpal and Zibal - and ONE takes new payments at a time. The picker at
// the top is that choice; the two blocks under it are each gateway's own credentials. BOTH
// BLOCKS ARE ALWAYS SHOWN, including the idle one's: a field hidden behind the picker would
// still be saved with the form, and a credential nobody can see being written is exactly the
// kind of surprise this panel exists to prevent. It also means the second gateway's merchant
// can be entered and checked BEFORE anything is switched to it.
//
// Switching strands nobody. A buyer already on the old gateway's page is still verified by
// that gateway when they come back - the server reads it off the order, not off this setting -
// so the picker is safe to change in the middle of a busy afternoon.
//
// THIS PANEL USED TO CARRY THE MAIL SERVER TOO. They are apart now because they fail apart:
// a broken mail key stops delivery and a wrong merchant id sends takings to a stranger,
// and an operator fixing one should never be editing a form that can save the other. Each
// panel sends ONLY its own fields, and the server treats an absent field as unchanged, so
// saving here cannot disturb the mail settings even by accident.
//
// THE PUBLIC ORIGIN IS HERE because it is a gateway fact, not a deployment one: it is the
// address the gateway sends the buyer back to, and getting it wrong strands every payment on
// the bank's page with the money taken and no code delivered. It used to be an environment
// variable, which meant the only way to fix that was a deploy - at exactly the moment an
// operator can least afford one. The callback URL below is derived from it and shown in full,
// because that is the string a gateway's own panel wants pasted into it.
//
// A SECRET IS NEVER SHOWN. A merchant input starts empty with a masked placeholder, and
// leaving it blank means "keep it" - so saving a host name cannot wipe a working credential.
// The server enforces that too; this component only has to not fight it.
//
// The gateway choice and the two merchants are the fields in the console that change WHERE THE
// MONEY GOES, so they are the fields that ask a second question before saving.
import { AlertTriangle, CreditCard, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { GatewayName, SettingsView } from '../../../../../server/src/contract/index.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import Select from '../../../ui/select.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/** What each gateway is called on screen. Typed against the server's list, so a third one cannot be forgotten here. */
const GATEWAY_LABELS: Record<GatewayName, string> = {
    zarinpal: 'زرین‌پال',
    zibal: 'زیبال'
};

const GATEWAY_OPTIONS = (Object.keys(GATEWAY_LABELS) as GatewayName[]).map((name) => ({
    value: name,
    label: GATEWAY_LABELS[name]
}));

/** The small tag beside a gateway's heading that says which one is taking payments. */
function ActiveBadge(props: { active: boolean }): ReactNode {
    return props.active ? (
        <span className="rounded-full bg-firouze/15 px-2.5 py-0.5 text-caption font-bold text-firouze">
            فعال
        </span>
    ) : (
        <span className="rounded-full bg-muted/15 px-2.5 py-0.5 text-caption font-bold text-muted">
            غیرفعال
        </span>
    );
}

export default function GatewaySettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [formPublicBase, setFormPublicBase] = useState('');
    const [formGateway, setFormGateway] = useState<GatewayName>('zarinpal');
    const [formBase, setFormBase] = useState('');
    const [formZibalBase, setFormZibalBase] = useState('');

    // The secrets start EMPTY, not pre-filled with the stored values: there are no stored
    // values to pre-fill with, because the server never sends one. Blank means "unchanged".
    const [formMerchantId, setFormMerchantId] = useState('');
    const [formZibalMerchant, setFormZibalMerchant] = useState('');

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const view = await client.admin.settings();
            setSettings(view);
            setFormPublicBase(view.publicBaseUrl);
            setFormGateway(view.paymentGateway);
            setFormBase(view.zarinpalBase);
            setFormZibalBase(view.zibalBase);
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
        // NOTHING IS SAVED BEFORE SOMETHING IS READ. Every field below is posted whether or
        // not it was touched, so submitting a form that never loaded would write the empty
        // boxes it is showing over whatever is actually stored. `settings` is null until a
        // read succeeds, which makes that state unreachable rather than merely unlikely.
        if (settings === null) {
            notify.error('تنظیمات هنوز خوانده نشده است. صفحه را تازه کنید.');
            return;
        }

        // Three fields here change WHERE THE MONEY GOES, and each deserves a second question.
        // They are asked as ONE question listing what is about to change: three dialogs in a
        // row teach an operator to click through them.
        const moves: string[] = [];
        if (formGateway !== settings.paymentGateway) {
            moves.push(
                `درگاه فعال از ${GATEWAY_LABELS[settings.paymentGateway]} به ${GATEWAY_LABELS[formGateway]} عوض می‌شود.`
            );
        }
        if (formMerchantId !== '') {
            moves.push('شناسهٔ پذیرندهٔ زرین‌پال عوض می‌شود.');
        }
        if (formZibalMerchant !== '') {
            moves.push('مرچنت زیبال عوض می‌شود.');
        }
        if (
            moves.length > 0 &&
            !confirm(`${moves.join('\n')}\n\nاین تغییر مقصد پول را عوض می‌کند. مطمئنید؟`)
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
                        paymentGateway: formGateway,
                        zarinpalBase: formBase,
                        merchantId: formMerchantId === '' ? undefined : formMerchantId,
                        zibalBase: formZibalBase,
                        zibalMerchant: formZibalMerchant === '' ? undefined : formZibalMerchant
                    }
                })
            );
            setFormMerchantId('');
            setFormZibalMerchant('');
            notify.success('تنظیمات درگاه ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    // Everything below describes what is STORED, not what is typed: a status line that turned
    // green the moment a box was filled in would be reporting a payment route nobody has saved.
    const active = settings?.paymentGateway ?? 'zarinpal';
    const ready =
        active === 'zibal' ? settings?.zibalMerchantSet === true : settings?.merchantIdSet === true;

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <CreditCard className="size-5 text-firouze" aria-hidden="true" />
                درگاه پرداخت
            </h2>

            <div className="mt-4">
                <Async
                    loading={loading || settings === null}
                    error={error}
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    <p className="mb-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-4 text-small">
                        <AlertTriangle className="size-5 shrink-0 text-gold" aria-hidden="true" />
                        <span>
                            تغییر درگاه فعال یا شناسهٔ پذیرنده مقصد پول را عوض می‌کند. شناسه‌ها پس از
                            ذخیره دیگر نمایش داده نمی‌شوند؛ برای نگه داشتن مقدار فعلی، کادر را خالی
                            بگذارید.
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
                            hint="آدرسی که خریدار با آن وارد سایت می‌شود. درگاه خریدار را به همین آدرس برمی‌گرداند، پس اگر اشتباه باشد پرداخت‌ها نیمه‌کاره می‌مانند."
                        >
                            <TextInput
                                id="public-base-url"
                                latin
                                placeholder="https://example.com"
                                value={formPublicBase}
                                onChange={setFormPublicBase}
                            />
                        </Field>

                        <Field
                            label="درگاه فعال"
                            htmlFor="payment-gateway"
                            className="mt-4"
                            hint="پرداخت‌های تازه به این درگاه می‌روند. پرداختی که پیش از تغییر شروع شده، با همان درگاه قبلی تأیید می‌شود."
                        >
                            <Select
                                id="payment-gateway"
                                label="درگاهی که پرداخت‌های تازه به آن می‌رود"
                                value={formGateway}
                                options={GATEWAY_OPTIONS}
                                onChange={(chosen) => setFormGateway(chosen as GatewayName)}
                            />
                        </Field>

                        <div className="mt-5 border-t border-line pt-4">
                            <h3 className="flex items-center gap-2 font-bold">
                                {GATEWAY_LABELS.zarinpal}
                                <ActiveBadge active={active === 'zarinpal'} />
                            </h3>

                            <Field
                                label="آدرس درگاه"
                                htmlFor="zarinpal-base"
                                className="mt-3"
                                hint="برای حالت آزمایشی، آدرس سندباکس زرین‌پال را بنویسید."
                            >
                                <TextInput
                                    id="zarinpal-base"
                                    latin
                                    value={formBase}
                                    onChange={setFormBase}
                                />
                            </Field>

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
                        </div>

                        <div className="mt-5 border-t border-line pt-4">
                            <h3 className="flex items-center gap-2 font-bold">
                                {GATEWAY_LABELS.zibal}
                                <ActiveBadge active={active === 'zibal'} />
                            </h3>

                            <Field label="آدرس درگاه" htmlFor="zibal-base" className="mt-3">
                                <TextInput
                                    id="zibal-base"
                                    latin
                                    value={formZibalBase}
                                    onChange={setFormZibalBase}
                                />
                            </Field>

                            <Field
                                label="مرچنت"
                                htmlFor="zibal-merchant"
                                className="mt-4"
                                hint="کد مرچنت را از بخش «درگاه پرداخت» پنل زیبال بردارید. برای حالت آزمایشی zibal بنویسید. دامنهٔ «آدرس عمومی فروشگاه» باید همان دامنه‌ای باشد که برای این درگاه در زیبال ثبت شده، وگرنه زیبال خریدار را به صفحهٔ پرداخت راه نمی‌دهد."
                            >
                                <TextInput
                                    id="zibal-merchant"
                                    latin
                                    autoComplete="off"
                                    placeholder={
                                        settings?.zibalMerchantSet === true
                                            ? `${settings.zibalMerchantMasked} (برای تغییر بنویسید)`
                                            : 'تنظیم نشده'
                                    }
                                    value={formZibalMerchant}
                                    onChange={setFormZibalMerchant}
                                />
                            </Field>
                        </div>

                        {/* A flex child defaults to `min-width: auto`, so an unbreakable
                            value refuses to shrink and pushes the row past the viewport -
                            which is exactly what this URL did. `min-w-0` is what lets it
                            shrink at all; `break-all` is what it does once it can. */}
                        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>درگاه فعال</dt>
                                <dd className="font-bold">{GATEWAY_LABELS[active]}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت درگاه</dt>
                                <dd
                                    className={
                                        ready ? 'font-bold text-firouze' : 'font-bold text-gold'
                                    }
                                >
                                    {ready ? 'آماده' : 'تنظیم نشده'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>حالت</dt>
                                <dd>
                                    {settings?.sandbox === true ? (
                                        <span className="text-gold">
                                            آزمایشی (سندباکس) - پولی جابه‌جا نمی‌شود.
                                        </span>
                                    ) : (
                                        <span>واقعی. پرداخت‌ها با پول واقعی انجام می‌شود.</span>
                                    )}
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
