// One purchasable tier, and the whole purchase inside it.
//
// The card used to show a sample gift code and a "choose" button that scrolled the reader
// down to a single form at the foot of the page. The form is IN THE CARD now: the buyer
// types their number on the card they are buying, so the amount is never a separate choice
// that can drift out of step with what they are looking at, and the journey is one place
// instead of two ends of a scroll.
//
// THE CONFIRM STEP SURVIVED THAT MOVE, and it matters MORE now than it did. The email address
// is the ONLY way the code reaches the buyer afterwards, and an address has far more ways to
// be wrong than a phone number does - a transposed letter in the domain is undeliverable and
// looks perfectly fine. Reading it back costs one tap and catches the typo before the money
// moves, which is why there is no confirmation link: that would cost the buyer a wait and the
// operator a round trip to catch the same mistake.
//
// THE PRICE IS NOW A MOVING TARGET, and this file is where that is made safe for the buyer.
// Card prices are derived from the tether rate the console set, so the figure on screen has a shelf
// life. Pressing «ادامه» PINS the number the buyer agreed to, and that pinned number is sent
// with the purchase. The server recomputes the price from its own rate and refuses if the two
// disagree - so a rate that moves mid-purchase produces a re-quote the buyer has to accept,
// never a silent charge for a different sum. The pinned figure is a promise about what was
// displayed; it is never the amount, and the server treats it as an assertion to check.
//
// A CARD WITH NO PRICE IS NOT A CARD WITH A ZERO. When no tether rate is set the server
// sends a null and this refuses to be bought, in the same words the ticker uses. Inventing a
// last-known price here would defeat the entire point of the server refusing a stale one.
//
// The three cards are NOT interchangeable boxes: the recommended one carries the firouze
// treatment, so the hierarchy comes from colour and content rather than a scale transform
// and a "popular" sticker.
//
// The amount is an LTR ISLAND inside an RTL block: only the inner span carries dir, so the
// characters read "$25" while the block still aligns to the RTL start. Putting dir on the
// block itself silently flips what `text-start` means.
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApiError, client, failureText } from '../lib/api.ts';
import { purchaseFormInput } from '../../../server/src/contract/index.ts';
import { useCatalog, type CatalogTier } from '../lib/catalog.tsx';
import { count, toman } from '../lib/format.ts';
import { useForm } from '../lib/use-form.ts';
import Button from '../ui/button.tsx';
import Field from '../ui/field.tsx';
import TextInput from '../ui/text-input.tsx';

export default function GiftCard({ tier }: { tier: CatalogTier }): ReactNode {
    const catalog = useCatalog();
    const [step, setStep] = useState<'email' | 'confirm'>('email');
    const [paying, setPaying] = useState(false);
    const [failure, setFailure] = useState('');

    // The price the buyer agreed to when they pressed «ادامه». Null means "take the live
    // one" - which is the state after a re-quote, so the fresh figure is what shows.
    const [quoted, setQuoted] = useState<number | null>(null);
    const [repriced, setRepriced] = useState(false);

    const form = useForm(purchaseFormInput, { email: '' });

    // `?? null` throughout: an older server mid-deploy answers without a `toman` at all, and
    // `undefined` must read as "no price" rather than slipping past a `=== null` check and
    // being rendered - or worse, sent - as a price.
    const listed = tier.toman ?? null;
    const price = quoted ?? listed;
    const soldOut = tier.available === 0;
    const unpriced = listed === null;
    const buyable = !soldOut && !unpriced;
    const inputId = `email-${tier.amount}`;

    const pay = async (): Promise<void> => {
        if (price === null) {
            return;
        }
        setPaying(true);
        setFailure('');
        setRepriced(false);
        try {
            const opened = await client.pay.start({
                input: {
                    amount: tier.amount,
                    email: form.values.email,
                    // What this card was showing. The server charges its own figure and uses
                    // this only to check the two still agree.
                    quotedToman: price
                }
            });
            // Leaving the page is the success case: the gateway owns the next screen.
            window.location.assign(opened.payUrl);
        } catch (error) {
            setPaying(false);

            // The rate moved between the quote and the button. Not a failure and not worth an
            // error voice: the buyer is shown the new number and asked again, which is the
            // whole reason the server refused rather than charging it.
            if (error instanceof ApiError && error.code === 'price-changed') {
                await catalog.refresh();
                setQuoted(null);
                setRepriced(true);
                return;
            }

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

            <p className="mt-1 min-h-5 text-small text-muted">
                {price === null ? 'فعلاً در دسترس نیست' : `${toman(price)} تومان`}
            </p>

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

                {step === 'email' ? (
                    <form
                        className="mt-3"
                        noValidate
                        onSubmit={form.handleSubmit(() => {
                            setFailure('');
                            setRepriced(false);
                            // PIN the figure on screen. From here to the gateway, this is the
                            // number the buyer agreed to and the one the server is held to.
                            setQuoted(listed);
                            setStep('confirm');
                        })}
                    >
                        <Field
                            label="ایمیل"
                            htmlFor={inputId}
                            error={
                                form.errorFor('email') === ''
                                    ? ''
                                    : 'ایمیل معتبر نیست. مثل name@example.com بنویسید.'
                            }
                            hint={
                                form.errorFor('email') === ''
                                    ? 'کد به همین ایمیل فرستاده می‌شود.'
                                    : undefined
                            }
                        >
                            <TextInput
                                id={inputId}
                                type="email"
                                latin
                                inputMode="email"
                                autoComplete="email"
                                placeholder="name@example.com"
                                disabled={!buyable}
                                invalid={form.errorFor('email') !== ''}
                                value={form.values.email}
                                onChange={(value) => form.set('email', value)}
                            />
                        </Field>

                        <Button
                            type="submit"
                            variant={tier.recommended ? 'primary' : 'outline'}
                            full
                            className="mt-4"
                            disabled={!buyable}
                        >
                            {soldOut ? 'ناموجود' : unpriced ? 'قیمت در دسترس نیست' : 'ادامه'}
                        </Button>
                    </form>
                ) : (
                    <div className="mt-3">
                        <div className="rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">ایمیل</p>
                            {/* `break-all`: an address can be longer than the card is wide,
                                and a clipped address is one the buyer cannot check. */}
                            <p
                                dir="ltr"
                                className="latin mt-1 text-start text-lg font-semibold break-all"
                            >
                                {form.values.email}
                            </p>
                            <button
                                type="button"
                                className="mt-2 min-h-tap text-caption font-bold text-firouze hover:underline"
                                onClick={() => setStep('email')}
                            >
                                ویرایش ایمیل
                            </button>
                        </div>

                        <dl className="mt-4 grid gap-2 text-small">
                            <div className="flex justify-between gap-2">
                                <dt className="shrink-0 text-muted">مبلغ قابل پرداخت</dt>
                                <dd className="min-w-0 text-end font-bold">
                                    {price === null ? '—' : `${toman(price)} تومان`}
                                </dd>
                            </div>
                        </dl>

                        {repriced && (
                            <p className="mt-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-caption">
                                <TriangleAlert
                                    className="size-4 shrink-0 text-gold"
                                    aria-hidden="true"
                                />
                                <span>
                                    قیمت این کارت به‌روز شد. پولی از حساب شما کم نشده است. اگر مبلغ
                                    تازه را قبول دارید دوباره پرداخت را بزنید.
                                </span>
                            </p>
                        )}

                        {failure !== '' && <p className="mt-4 text-small text-danger">{failure}</p>}

                        <Button
                            variant="primary"
                            full
                            trailing={ArrowRight}
                            className="mt-4"
                            busy={paying}
                            busyText="در حال انتقال به درگاه..."
                            disabled={!buyable || price === null}
                            onClick={() => void pay()}
                        >
                            {price === null ? 'قیمت در دسترس نیست' : `پرداخت ${toman(price)} تومان`}
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
