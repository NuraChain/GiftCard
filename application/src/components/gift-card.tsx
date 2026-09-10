// One purchasable tier, and the whole purchase inside it.
//
// The card used to show a sample gift code and a "choose" button that scrolled the reader
// down to a single form at the foot of the page. The form is IN THE CARD now: the buyer
// types their number on the card they are buying, so the amount is never a separate choice
// that can drift out of step with what they are looking at, and the journey is one place
// instead of two ends of a scroll.
//
// THE CONFIRM STEP SURVIVED THAT MOVE, and it is not decoration. The phone number is the
// ONLY way the code reaches the buyer afterwards, and a mistyped digit is discovered at the
// worst possible moment - after the money has moved. Reading the number back costs one tap
// and catches the typo for free, which is why there is no verification code: an OTP would
// cost the buyer a wait and the operator a message to catch the same mistake.
//
// The three cards are NOT interchangeable boxes: the recommended one carries the firouze
// treatment, so the hierarchy comes from colour and content rather than a scale transform
// and a "popular" sticker.
//
// The amount is an LTR ISLAND inside an RTL block: only the inner span carries dir, so the
// characters read "$25" while the block still aligns to the RTL start. Putting dir on the
// block itself silently flips what `text-start` means.
import { ArrowRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { client, failureText } from '../lib/api.ts';
import { purchaseFormInput } from '../../../server/src/contract/index.ts';
import type { CatalogTier } from '../lib/catalog.tsx';
import { count, toman } from '../lib/format.ts';
import { useForm } from '../lib/use-form.ts';
import Button from '../ui/button.tsx';
import Field from '../ui/field.tsx';
import TextInput from '../ui/text-input.tsx';

export default function GiftCard({ tier }: { tier: CatalogTier }): ReactNode {
    const [step, setStep] = useState<'phone' | 'confirm'>('phone');
    const [paying, setPaying] = useState(false);
    const [failure, setFailure] = useState('');

    const form = useForm(purchaseFormInput, { phone: '' });
    const soldOut = tier.available === 0;
    const inputId = `phone-${tier.amount}`;

    const pay = async (): Promise<void> => {
        setPaying(true);
        setFailure('');
        try {
            const opened = await client.pay.start({
                input: { amount: tier.amount, phone: form.values.phone }
            });
            // Leaving the page is the success case: the gateway owns the next screen.
            window.location.assign(opened.payUrl);
        } catch (error) {
            setPaying(false);
            setFailure(
                failureText(
                    error,
                    'شروع پرداخت ممکن نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.'
                )
            );
        }
    };

    return (
        <article
            className={`flex flex-col rounded-2xl border bg-surface p-5 sm:p-6 ${
                tier.recommended
                    ? 'border-firouze shadow-[0_1px_24px_-8px_var(--firouze)]'
                    : 'border-line'
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{tier.title}</h3>
                {tier.recommended && (
                    <span className="rounded-full bg-firouze/15 px-2.5 py-0.5 text-caption font-bold text-firouze">
                        انتخاب بیشتر کاربران
                    </span>
                )}
            </div>

            <p className="mt-3 text-start text-3xl font-bold sm:text-4xl">
                <span dir="ltr" className="latin inline-block">
                    ${tier.amount}
                </span>
            </p>

            <p className="mt-1 text-small text-muted">{toman(tier.toman)} تومان</p>

            <p className="mt-3 text-small text-muted">{tier.blurb}</p>

            {/* `mt-auto` pins the purchase to the bottom of the card. The blurbs are
                different lengths, so without it the inputs sit at three different levels
                across a row and the grid reads as broken rather than as a set. */}
            <div className="mt-auto pt-4">
                <p className="min-h-5 text-caption">
                    {soldOut ? (
                        <span className="text-muted">فعلاً موجود نیست</span>
                    ) : (
                        <span className="text-firouze">{count(tier.available)} کد آماده تحویل</span>
                    )}
                </p>

                {step === 'phone' ? (
                    <form
                        className="mt-3"
                        noValidate
                        onSubmit={form.handleSubmit(() => {
                            setFailure('');
                            setStep('confirm');
                        })}
                    >
                        <Field
                            label="شماره موبایل"
                            htmlFor={inputId}
                            error={
                                form.errorFor('phone') === ''
                                    ? ''
                                    : 'شماره موبایل معتبر نیست. مثل ۰۹۱۷۰۴۵۹۳۳۰ بنویسید.'
                            }
                            hint={
                                form.errorFor('phone') === ''
                                    ? 'کد به همین شماره پیامک می‌شود.'
                                    : undefined
                            }
                        >
                            <TextInput
                                id={inputId}
                                type="tel"
                                latin
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="09170459330"
                                disabled={soldOut}
                                invalid={form.errorFor('phone') !== ''}
                                value={form.values.phone}
                                onChange={(value) => form.set('phone', value)}
                            />
                        </Field>

                        <Button
                            type="submit"
                            variant={tier.recommended ? 'primary' : 'outline'}
                            full
                            className="mt-4"
                            disabled={soldOut}
                        >
                            {soldOut ? 'ناموجود' : 'ادامه'}
                        </Button>
                    </form>
                ) : (
                    <div className="mt-3">
                        <div className="rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">شمارهٔ موبایل</p>
                            <p dir="ltr" className="latin mt-1 text-start text-lg font-semibold">
                                {form.values.phone}
                            </p>
                            <button
                                type="button"
                                className="mt-2 min-h-tap text-caption font-bold text-firouze hover:underline"
                                onClick={() => setStep('phone')}
                            >
                                ویرایش شماره
                            </button>
                        </div>

                        <dl className="mt-4 grid gap-2 text-small">
                            <div className="flex justify-between gap-2">
                                <dt className="shrink-0 text-muted">مبلغ قابل پرداخت</dt>
                                <dd className="min-w-0 text-end font-bold">
                                    {toman(tier.toman)} تومان
                                </dd>
                            </div>
                        </dl>

                        {failure !== '' && <p className="mt-4 text-small text-danger">{failure}</p>}

                        <Button
                            variant="primary"
                            full
                            trailing={ArrowRight}
                            className="mt-4"
                            busy={paying}
                            busyText="در حال انتقال به درگاه..."
                            disabled={soldOut}
                            onClick={() => void pay()}
                        >
                            پرداخت {toman(tier.toman)} تومان
                        </Button>

                        <p className="mt-3 text-caption text-muted">
                            پرداخت روی درگاه زرین‌پال انجام می‌شود. اطلاعات کارت بانکی شما به سرور ما
                            نمی‌رسد.
                        </p>
                    </div>
                )}
            </div>
        </article>
    );
}
