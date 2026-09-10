// Loading stock: paste a batch from the supplier, one code per line.
//
// The count of what WILL be submitted is on screen before the button is pressed. Nobody
// reads a pasted batch line by line, so a paste that silently lost half a supplier's list
// is only discoverable if the number is visible beforehand.
//
// `onAdded` is how the inventory table beside this form learns to refetch - the parent owns
// that, because a form should not know what else is on the page.
import { Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { AddCodesResult, TierRow } from '../../../../../server/src/contract/index.ts';
import { count } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Button from '../../../ui/button.tsx';
import Field from '../../../ui/field.tsx';
import Select from '../../../ui/select.tsx';

export interface PasteFormProps {
    tiers: TierRow[];
    onAdded: () => void;
}

export default function PasteForm({ tiers, onAdded }: PasteFormProps): ReactNode {
    const notify = useToasts();

    const [amount, setAmount] = useState(0);
    const [paste, setPaste] = useState('');
    const [pasting, setPasting] = useState(false);
    const [result, setResult] = useState<AddCodesResult | null>(null);

    const options = tiers.map((tier) => ({
        value: String(tier.amount),
        label: `$${tier.amount} - ${tier.title}`
    }));

    // Default to the recommended card, or the first one. There is no fixed set of
    // denominations any more, so there is no constant to default to.
    useEffect(() => {
        if (amount === 0 && tiers.length > 0) {
            setAmount((tiers.find((tier) => tier.recommended) ?? tiers[0]).amount);
        }
    }, [tiers, amount]);

    /**
     * The lines a paste will actually submit. Counted BEFORE sending, because the whole
     * point of pasting a batch is that nobody reads it line by line - and a paste that
     * silently lost half a supplier's list is only discoverable if the count is on screen
     * before the button is pressed.
     */
    const pastedLines = paste.split(/[\s,;]+/).filter((line) => line !== '');

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setPasting(true);
        setResult(null);
        try {
            const added = await client.admin.addCodes({ input: { amount, codes: pastedLines } });
            setResult(added);
            setPaste('');
            onAdded();
            if (added.added > 0) {
                notify.success(`${count(added.added)} کد به موجودی $${amount} افزوده شد`);
            } else {
                notify.info('هیچ کد تازه‌ای افزوده نشد');
            }
        } catch (failure) {
            notify.error(failureText(failure, 'افزودن کدها انجام نشد'));
        } finally {
            setPasting(false);
        }
    };

    return (
        <section>
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Plus className="size-5 text-firouze" aria-hidden="true" />
                افزودن کد
            </h2>
            <p className="mt-2 text-small text-muted">
                کدها را از تأمین‌کننده بگیرید و اینجا بچسبانید؛ هر کد در یک خط. فقط شناسهٔ استاندارد
                <span dir="ltr" className="latin mx-1">
                    UUID
                </span>
                پذیرفته می‌شود و کد تکراری دوباره ثبت نمی‌شود.
            </p>

            <form
                className="mt-4 rounded-2xl border border-line bg-surface p-5"
                noValidate
                onSubmit={(event) => void submit(event)}
            >
                {/* A picker rather than a row of chips: the catalogue is the operator's, so
                    this list is as long as they have made it, and eight chips wrap. */}
                {tiers.length > 0 ? (
                    <Field label="مبلغ کارت" htmlFor="paste-amount">
                        <Select
                            id="paste-amount"
                            label="مبلغ کارتی که این کدها برای آن است"
                            value={String(amount)}
                            options={options}
                            onChange={(chosen) => setAmount(Number(chosen))}
                        />
                    </Field>
                ) : (
                    <p className="text-small text-muted">ابتدا از تب تنظیمات یک کارت بسازید.</p>
                )}

                <div className="mt-5 flex items-baseline justify-between gap-3">
                    <label className="block text-small font-bold" htmlFor="codes">
                        کدها
                    </label>
                    <p className="text-caption text-muted">
                        {pastedLines.length > 0 ? (
                            <span>{count(pastedLines.length)} کد آمادهٔ افزودن</span>
                        ) : (
                            <span>هر کد در یک خط</span>
                        )}
                    </p>
                </div>
                <textarea
                    id="codes"
                    dir="ltr"
                    rows={6}
                    spellCheck={false}
                    className="latin mt-2 w-full rounded-xl border border-line bg-paper p-4 text-start text-small outline-none focus:border-firouze"
                    placeholder="7f3c1e2a-9b04-4d68-a5c1-0e7b2d9f4a31"
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                ></textarea>

                {/* Each number on its own line. Run together with a separator, Persian
                    digits merge into one another: "۴ · ۱ · ۱" reads as a single number,
                    and this is the screen where a misread count means a mis-stocked shop. */}
                {result !== null && (
                    <dl className="mt-4 grid gap-1 rounded-xl border border-line bg-paper p-4 text-small">
                        <div className="flex justify-between gap-2">
                            <dt>افزوده شد</dt>
                            <dd className="font-bold text-firouze">{count(result.added)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt className="text-muted">تکراری، نادیده گرفته شد</dt>
                            <dd>{count(result.duplicate)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt
                                className={result.invalid.length > 0 ? 'text-danger' : 'text-muted'}
                            >
                                نامعتبر
                            </dt>
                            <dd
                                className={result.invalid.length > 0 ? 'font-bold text-danger' : ''}
                            >
                                {count(result.invalid.length)}
                            </dd>
                        </div>
                        {result.invalid.length > 0 && (
                            <div className="mt-2 border-t border-line pt-2">
                                <p className="text-caption text-danger">این خط‌ها ثبت نشدند:</p>
                                <ul
                                    dir="ltr"
                                    className="latin mt-1 text-start text-caption text-muted"
                                >
                                    {result.invalid.map((line) => (
                                        <li key={line}>{line}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </dl>
                )}

                <Button
                    type="submit"
                    variant="primary"
                    className="mt-5"
                    busy={pasting}
                    busyText="در حال افزودن..."
                    disabled={paste.trim() === '' || amount === 0}
                >
                    افزودن به موجودی
                </Button>
            </form>
        </section>
    );
}
