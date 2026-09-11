// The catalogue editor: what the shop sells. NOT at what price.
//
// THERE IS NO PRICE FIELD HERE ANY MORE. A card costs its dollar figure times the tether
// rate times one shop-wide margin, so the only two things an operator sets are the
// denomination (below) and the margin (the pricing panel underneath this one). The Toman
// figure beside each card is a PREVIEW of that arithmetic, computed by the server on the way
// out - it is read-only because typing over it would be inventing a second price that the
// next rate refresh would silently contradict.
//
// A removal is not necessarily a delete. A tier with codes or orders behind it is
// DEACTIVATED so the history that explains what someone paid survives - the server decides
// which of the two happened and the notice reports it, so the dialog promises the weaker one.
import { Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { TierInput, TierRow } from '../../../../../server/src/contract/index.ts';
import { toman } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import TextInput from '../../../ui/text-input.tsx';
import { useAdminSession } from '../session.tsx';

/** A blank card, ready to be filled in. */
function emptyTier(sort: number): TierInput {
    return { amount: 0, title: '', blurb: '', recommended: false, active: true, sort };
}

/**
 * A saved card, as the editor holds it. The computed `toman` is dropped on the way in: it is
 * the server's answer, and sending it back would be the console claiming to set a price.
 */
function toDraft(tier: TierRow): TierInput {
    return {
        amount: tier.amount,
        title: tier.title,
        blurb: tier.blurb,
        recommended: tier.recommended,
        active: tier.active,
        sort: tier.sort
    };
}

export default function TierSettings(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [tiers, setTiers] = useState<TierRow[]>([]);
    const [draft, setDraft] = useState<TierInput | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            setTiers((await client.admin.tiers()).tiers);
        } catch (failure) {
            setError(failureText(failure, 'کارت‌ها خوانده نشدند'));
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

    const saveTier = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (draft === null) {
            return;
        }
        setSaving(true);
        try {
            setTiers((await client.admin.saveTier({ input: draft })).tiers);
            notify.success(`کارت $${draft.amount} ذخیره شد`);
            setDraft(null);
        } catch (failure) {
            notify.error(failureText(failure, 'ذخیره نشد'));
        } finally {
            setSaving(false);
        }
    };

    const removeTier = async (tier: TierRow): Promise<void> => {
        // A tier with codes or orders behind it is DEACTIVATED rather than deleted, so the
        // dialog promises the weaker of the two - the server decides which actually happens
        // and the notice below reports it.
        if (!confirm(`کارت $${tier.amount} از فروش برداشته شود؟`)) {
            return;
        }
        try {
            const result = await client.admin.removeTier({ query: { amount: tier.amount } });
            await load();
            notify.success(
                result.outcome === 'deleted'
                    ? `کارت $${tier.amount} حذف شد`
                    : `کارت $${tier.amount} از فروش برداشته شد. سابقهٔ فروش آن نگه داشته می‌شود.`
            );
        } catch (failure) {
            notify.error(failureText(failure, 'حذف نشد'));
        }
    };

    return (
        <section>
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="flex items-center gap-2 text-h3 font-bold">
                    <Settings2 className="size-5 text-firouze" aria-hidden="true" />
                    کارت‌ها
                </h2>
                <Button
                    glyph={Plus}
                    compact
                    className="ms-auto"
                    onClick={() => setDraft(emptyTier((tiers.length + 1) * 10))}
                >
                    کارت تازه
                </Button>
            </div>
            <p className="mt-2 text-small text-muted">
                مبلغ دلاری نام کارت است؛ قیمت تومانی از نرخ تتر حساب می‌شود و اینجا فقط نمایش داده
                می‌شود. کارتی که غیرفعال شود از فروشگاه برداشته می‌شود ولی سابقه‌اش می‌ماند.
            </p>

            <div className="mt-4">
                <Async
                    loading={loading && tiers.length === 0}
                    error={error}
                    empty={!loading && tiers.length === 0 && draft === null}
                    emptyText="هنوز کارتی تعریف نشده است."
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-40 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    {/* `sm:contents` dissolves the wrapper from `sm` up, so the desktop row is
                        the same single flex line it always was. Below that the card is two
                        blocks - what the tier IS, then what you can do to it - rather than
                        four labels and two buttons wrapping into four lines. */}
                    <ul className="grid gap-3">
                        {tiers.map((tier) => (
                            <li
                                key={tier.amount}
                                className={`rounded-2xl border p-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3 ${
                                    tier.active
                                        ? 'border-line bg-surface'
                                        : 'border-line/60 bg-surface/50'
                                }`}
                            >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
                                    <span dir="ltr" className="latin text-lg font-bold">
                                        ${tier.amount}
                                    </span>
                                    <span className="text-small">{tier.title}</span>
                                    <span className="text-small text-muted">
                                        {tier.toman === null
                                            ? 'قیمت در دسترس نیست'
                                            : `${toman(tier.toman)} تومان`}
                                    </span>
                                    {tier.recommended && (
                                        <span className="rounded-full bg-firouze/15 px-2.5 py-0.5 text-caption font-bold text-firouze">
                                            پیشنهادی
                                        </span>
                                    )}
                                    {!tier.active && (
                                        <span className="rounded-full bg-muted/15 px-2.5 py-0.5 text-caption font-bold text-muted">
                                            غیرفعال
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 flex gap-2 sm:mt-0 sm:ms-auto">
                                    <Button size="sm" grow onClick={() => setDraft(toDraft(tier))}>
                                        ویرایش
                                    </Button>
                                    <Button
                                        size="sm"
                                        grow
                                        variant="retreat"
                                        glyph={Trash2}
                                        onClick={() => void removeTier(tier)}
                                    >
                                        حذف
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </Async>
            </div>

            {draft !== null && (
                <form
                    className="mt-4 rounded-2xl border border-firouze bg-surface p-5"
                    noValidate
                    onSubmit={(event) => void saveTier(event)}
                >
                    <h3 className="font-bold">
                        {draft.amount > 0 ? (
                            <span>
                                ویرایش کارت{' '}
                                <span dir="ltr" className="latin">
                                    ${draft.amount}
                                </span>
                            </span>
                        ) : (
                            <span>کارت تازه</span>
                        )}
                    </h3>

                    <Field
                        label="مبلغ دلاری"
                        htmlFor="tier-amount"
                        className="mt-4"
                        hint="قیمت تومانی از این عدد و نرخ تتر حساب می‌شود."
                    >
                        <TextInput
                            id="tier-amount"
                            type="number"
                            latin
                            value={String(draft.amount)}
                            onChange={(next) => setDraft({ ...draft, amount: Number(next) })}
                        />
                    </Field>

                    <Field label="عنوان" htmlFor="tier-title" className="mt-4">
                        <TextInput
                            id="tier-title"
                            value={draft.title}
                            onChange={(next) => setDraft({ ...draft, title: next })}
                        />
                    </Field>

                    <label className="mt-4 block text-small font-bold" htmlFor="tier-blurb">
                        توضیح روی کارت
                    </label>
                    <textarea
                        id="tier-blurb"
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-line bg-paper p-4 text-small outline-none focus:border-firouze"
                        value={draft.blurb}
                        onChange={(event) => setDraft({ ...draft, blurb: event.target.value })}
                    ></textarea>

                    <div className="mt-4 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-small">
                            <input
                                type="checkbox"
                                checked={draft.active}
                                onChange={(event) =>
                                    setDraft({ ...draft, active: event.target.checked })
                                }
                            />
                            فعال (در فروشگاه دیده می‌شود)
                        </label>
                        <label className="flex items-center gap-2 text-small">
                            <input
                                type="checkbox"
                                checked={draft.recommended}
                                onChange={(event) =>
                                    setDraft({ ...draft, recommended: event.target.checked })
                                }
                            />
                            پیشنهادی (فقط یکی می‌تواند باشد)
                        </label>
                    </div>

                    <div className="mt-5 flex gap-2">
                        <Button
                            type="submit"
                            variant="primary"
                            glyph={Save}
                            busy={saving}
                            busyText="در حال ذخیره..."
                            disabled={draft.amount < 1 || draft.title === ''}
                        >
                            ذخیره
                        </Button>
                        <Button onClick={() => setDraft(null)}>انصراف</Button>
                    </div>
                </form>
            )}
        </section>
    );
}
