// Pricing: the two numbers every card rides on, and a live view of whether the shop can price
// anything at all.
//
// THIS PANEL IS NOW THE SOURCE OF THE PRICE, not a window onto one. The tether rate used to be
// read from two exchanges and cross-checked; it is typed here instead, so this form is the
// only thing between an operator and the price of every card in the shop.
//
// THAT PUTS THE WHOLE WEIGHT ON THREE GUARDS, because there is no second source left to
// disagree with a wrong number:
//   - the BAND, which refuses a rate with an extra zero or a missing one (server:
//     domain/pricing.ts), checked here first and again at the boundary;
//   - the CONFIRM, which reads the rate and the margin back in words before anything is
//     saved, because a number that multiplies every card deserves a second question;
//   - the AGE, shown at the top and warned about once the rate is old, since nothing is
//     coming to refresh it and only the operator can notice it has drifted.
//
// The margin sits beside the rate rather than on a card because it applies to all of them. A
// per-card price would be a second answer to a question these two already answer, and the two
// would disagree the moment either moved - see server: domain/pricing.ts.
import { Percent, RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { RateStatusView, SettingsView } from '../../../../../server/src/contract/index.ts';
import { MAX_TETHER_TOMAN, MIN_TETHER_TOMAN } from '../../../../../server/src/domain/pricing.ts';
import { ago, toman } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import { useCatalog } from '../../../lib/catalog.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/**
 * How often the panel re-reads the rate.
 *
 * The number itself only changes when somebody saves it, but its AGE changes every second and
 * the age is what this panel exists to make visible. Without the poll an operator could leave
 * the tab open all afternoon and keep reading «همین حالا» about a rate from the morning.
 */
const POLL_MS = 60_000;

export default function PricingSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();
    const catalog = useCatalog();

    const [status, setStatus] = useState<RateStatusView | null>(null);
    const [settings, setSettings] = useState<SettingsView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const [formTether, setFormTether] = useState('');
    const [formMargin, setFormMargin] = useState('');

    const loadStatus = useCallback(async (): Promise<void> => {
        try {
            setStatus(await client.admin.rate());
        } catch {
            // The panel below already reports a load failure; a poll that misses must not
            // replace a working page with an error.
        }
    }, []);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const [view, rate] = await Promise.all([client.admin.settings(), client.admin.rate()]);
            setSettings(view);
            setStatus(rate);
            setFormMargin(String(view.marginPercent));
            // A zero means "never set", and an empty box is the honest way to show that - a
            // literal ۰ in the field reads like a price somebody chose.
            setFormTether(view.tetherToman === 0 ? '' : String(view.tetherToman));
        } catch (failure) {
            setError(failureText(failure, 'تنظیمات قیمت خوانده نشد'));
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

    useEffect(() => {
        if (!session.unlocked) {
            return;
        }
        const timer = setInterval(() => void loadStatus(), POLL_MS);
        return () => clearInterval(timer);
    }, [session.unlocked, loadStatus]);

    const save = async (event: FormEvent): Promise<void> => {
        event.preventDefault();

        const margin = Number(formMargin);
        if (!Number.isFinite(margin) || margin < 0 || margin > 100) {
            notify.error('درصد سود باید عددی بین ۰ تا ۱۰۰ باشد');
            return;
        }

        // An empty box is not a zero. Zero is a deliberate "stop selling" and is typed as
        // such; a blank field is somebody who has not finished, and saving it as zero would
        // take the shop down by accident.
        if (formTether.trim() === '') {
            notify.error('نرخ تتر را وارد کنید');
            return;
        }
        const tether = Number(formTether);
        if (!Number.isInteger(tether) || tether < 0) {
            notify.error('نرخ تتر باید یک عدد صحیح تومانی باشد');
            return;
        }
        // The same band the server enforces, checked here first so the operator gets a
        // sentence rather than a rejected request.
        if (tether !== 0 && (tether < MIN_TETHER_TOMAN || tether > MAX_TETHER_TOMAN)) {
            notify.error(
                `نرخ تتر باید بین ${toman(MIN_TETHER_TOMAN)} و ${toman(MAX_TETHER_TOMAN)} تومان باشد`
            );
            return;
        }

        // Both numbers multiply EVERY card at once, and nothing cross-checks them any more, so
        // they are read back in words before anything is written.
        const question =
            tether === 0
                ? 'با ثبت صفر، فروشگاه تا وقتی نرخ تازه‌ای ثبت نشود هیچ کارتی نمی‌فروشد. مطمئنید؟'
                : `هر تتر ${toman(tether)} تومان با ${margin}٪ سود. قیمت همهٔ کارت‌ها از همین حساب می‌شود. مطمئنید؟`;
        if (!confirm(question)) {
            return;
        }

        setSaving(true);
        try {
            setSettings(
                await client.admin.saveSettings({
                    input: { marginPercent: margin, tetherToman: tether }
                })
            );
            await loadStatus();
            // Prices on the storefront are derived, so this is a price change everywhere. The
            // shop is told to re-read rather than left showing the old ones.
            void catalog.refresh();
            notify.success('تنظیمات قیمت ذخیره شد');
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    // Normalised once, so every read below is a strict comparison rather than a chain of
    // optional accesses that each have to remember the difference between null and undefined.
    const liveRate = status?.rate ?? null;
    const selling = status?.selling === true;

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Percent className="size-5 text-firouze" aria-hidden="true" />
                قیمت‌گذاری
            </h2>
            <p className="mt-2 text-small text-muted">
                قیمت هر کارت از نرخ تتر ضرب در مبلغ دلاری کارت به‌دست می‌آید و درصد سود روی آن اعمال
                می‌شود. نرخ را خودتان همین‌جا وارد می‌کنید و تا وقتی عوضش نکنید همین می‌ماند، پس هر بار
                که بازار جابه‌جا شد به‌روزش کنید.
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
                    {/* The live picture first: an operator opening this panel is far more
                        likely to be checking than configuring. */}
                    <div
                        className={`rounded-2xl border p-5 ${
                            selling ? 'border-line bg-surface' : 'border-gold/40 bg-gold/10'
                        }`}
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="font-bold">نرخ تتر فعلی</h3>
                            <Button size="sm" glyph={RefreshCw} onClick={() => void loadStatus()}>
                                تازه‌سازی
                            </Button>
                        </div>

                        <p className="mt-3 text-2xl font-bold">
                            {liveRate === null ? 'تنظیم نشده' : `${toman(liveRate.toman)} تومان`}
                        </p>

                        {status !== null && status.reason !== '' && (
                            <p className="mt-2 text-small text-gold">{status.reason}</p>
                        )}

                        {/* The one warning this panel exists to raise. Nothing refreshes the
                            rate, so an old number keeps selling until somebody looks. */}
                        {liveRate?.stale === true && (
                            <p className="mt-2 flex items-start gap-2 text-small text-gold">
                                <TriangleAlert
                                    className="mt-0.5 size-4 shrink-0"
                                    aria-hidden="true"
                                />
                                <span>
                                    این نرخ مدتی است به‌روز نشده و کارت‌ها هنوز با همین قیمت فروخته
                                    می‌شوند. نرخ تازه را وارد کنید.
                                </span>
                            </p>
                        )}

                        <dl className="mt-4 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت فروش</dt>
                                <dd
                                    className={
                                        selling ? 'font-bold text-firouze' : 'font-bold text-gold'
                                    }
                                >
                                    {selling ? 'باز' : 'بسته'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>آخرین به‌روزرسانی</dt>
                                <dd>{liveRate === null ? '—' : ago(liveRate.at)}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>درصد سود</dt>
                                <dd>{status === null ? '—' : `${status.marginPercent}٪`}</dd>
                            </div>
                        </dl>
                    </div>

                    <form
                        className="mt-4 rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                                label="نرخ هر تتر (تومان)"
                                htmlFor="tether-toman"
                                hint="قیمت همهٔ کارت‌ها از این عدد حساب می‌شود. صفر یعنی فعلاً چیزی فروخته نشود."
                            >
                                <TextInput
                                    id="tether-toman"
                                    type="number"
                                    latin
                                    value={formTether}
                                    onChange={setFormTether}
                                />
                            </Field>

                            <Field
                                label="درصد سود"
                                htmlFor="margin-percent"
                                hint="روی همهٔ کارت‌ها اعمال می‌شود. قیمت نهایی به بالا و به نزدیک‌ترین هزار تومان گرد می‌شود."
                            >
                                <TextInput
                                    id="margin-percent"
                                    type="number"
                                    latin
                                    value={formMargin}
                                    onChange={setFormMargin}
                                />
                            </Field>
                        </div>

                        <Button
                            type="submit"
                            variant="primary"
                            glyph={Save}
                            className="mt-5"
                            busy={saving}
                            busyText="در حال ذخیره..."
                        >
                            ذخیره قیمت‌گذاری
                        </Button>
                    </form>
                </Async>
            </div>
        </section>
    );
}
