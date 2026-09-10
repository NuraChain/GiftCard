// Pricing: the one margin every card rides on, the two exchanges it rides on top of, and a
// live view of whether the shop can price anything at all.
//
// THIS PANEL EXISTS TO ANSWER ONE QUESTION AT 2AM: "why is nothing buyable?". The cards go
// unbuyable whenever two exchanges cannot be made to agree, and without this the operator
// would be left guessing between a dead API, a blocked host, a mispriced market and a bug.
// So it shows what EACH source last answered, by name, with its own failure text - and the
// spread between them, which is the number that decides everything.
//
// The margin sits here rather than on a card because it applies to all of them. A per-card
// price would be a second answer to a question the tether rate already answers, and the two
// would disagree the moment the rate moved - see server: domain/pricing.ts.
import { Percent, RefreshCw, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { RateStatusView, SettingsView } from '../../../../../server/src/contract/index.ts';
import { toman } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import { useCatalog } from '../../../lib/catalog.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/** The console re-reads the rate on the server's own cadence, so the panel is never behind. */
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

    const [formMargin, setFormMargin] = useState('');
    const [formNobitex, setFormNobitex] = useState('');
    const [formWallex, setFormWallex] = useState('');

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
            setFormNobitex(view.nobitexBase);
            setFormWallex(view.wallexBase);
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
        // The margin multiplies EVERY card at once, so it gets the same second question the
        // merchant id gets - it is the other field on this console that moves money.
        if (!confirm(`درصد سود روی همهٔ کارت‌ها ${margin}٪ می‌شود. مطمئنید؟`)) {
            return;
        }
        setSaving(true);
        try {
            setSettings(
                await client.admin.saveSettings({
                    input: {
                        marginPercent: margin,
                        nobitexBase: formNobitex,
                        wallexBase: formWallex
                    }
                })
            );
            await loadStatus();
            // Prices on the storefront are derived, so a margin change is a price change
            // everywhere. The shop is told to re-read rather than left showing the old ones.
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
    const ageSeconds = status?.ageSeconds ?? null;
    const spreadPercent = status?.spreadPercent ?? null;

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Percent className="size-5 text-firouze" aria-hidden="true" />
                قیمت‌گذاری
            </h2>
            <p className="mt-2 text-small text-muted">
                قیمت هر کارت از نرخ لحظه‌ای تتر ضرب در مبلغ دلاری کارت به‌دست می‌آید و درصد سود روی آن
                اعمال می‌شود. نرخ از دو صرافی خوانده و با هم مقایسه می‌شود؛ اگر اختلافشان زیاد باشد یا
                هیچ‌کدام جواب ندهند، فروشگاه تا رفع مشکل چیزی نمی‌فروشد.
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
                        likely to be diagnosing than configuring. */}
                    <div
                        className={`rounded-2xl border p-5 ${
                            status?.selling === true
                                ? 'border-line bg-surface'
                                : 'border-gold/40 bg-gold/10'
                        }`}
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="font-bold">نرخ لحظه‌ای تتر</h3>
                            <Button size="sm" glyph={RefreshCw} onClick={() => void loadStatus()}>
                                تازه‌سازی
                            </Button>
                        </div>

                        <p className="mt-3 text-2xl font-bold">
                            {liveRate === null ? 'در دسترس نیست' : `${toman(liveRate.toman)} تومان`}
                        </p>

                        {status !== null && status.reason !== '' && (
                            <p className="mt-2 text-small text-gold">{status.reason}</p>
                        )}

                        <dl className="mt-4 grid gap-2 border-t border-line pt-4 text-caption text-muted">
                            <div className="flex justify-between gap-2">
                                <dt>وضعیت فروش</dt>
                                <dd
                                    className={
                                        status?.selling === true
                                            ? 'font-bold text-firouze'
                                            : 'font-bold text-gold'
                                    }
                                >
                                    {status?.selling === true ? 'باز' : 'بسته'}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>سن نرخ</dt>
                                <dd>{ageSeconds === null ? '—' : `${toman(ageSeconds)} ثانیه`}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt>اختلاف دو منبع</dt>
                                <dd>
                                    {spreadPercent === null ? '—' : `${spreadPercent.toFixed(2)}٪`}
                                </dd>
                            </div>
                        </dl>

                        {/* Per source, by name. "rate unavailable" is not actionable;
                            "wallex: no answer" is. */}
                        <ul className="mt-4 grid gap-2 border-t border-line pt-4 text-caption">
                            {(status?.readings ?? []).map((reading) => (
                                <li key={reading.name} className="flex justify-between gap-2">
                                    <span dir="ltr" className="latin shrink-0 font-bold">
                                        {reading.name}
                                    </span>
                                    <span
                                        className={
                                            reading.toman === null
                                                ? 'min-w-0 text-end text-gold'
                                                : 'min-w-0 text-end text-muted'
                                        }
                                    >
                                        {reading.toman === null
                                            ? reading.reason
                                            : `${toman(reading.toman)} تومان`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <form
                        className="mt-4 rounded-2xl border border-line bg-surface p-5"
                        noValidate
                        onSubmit={(event) => void save(event)}
                    >
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

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <Field label="آدرس نوبیتکس" htmlFor="nobitex-base">
                                <TextInput
                                    id="nobitex-base"
                                    latin
                                    value={formNobitex}
                                    onChange={setFormNobitex}
                                />
                            </Field>
                            <Field label="آدرس والکس" htmlFor="wallex-base">
                                <TextInput
                                    id="wallex-base"
                                    latin
                                    value={formWallex}
                                    onChange={setFormWallex}
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
