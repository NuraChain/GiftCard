// What happened to a payment, read back after the bank sends the buyer here.
//
// This is all that remains of the old purchase panel. The phone step and the confirm step
// moved into the cards; what could not move is this, because the buyer arrives at it from
// the GATEWAY rather than from a click, carrying a token in the URL. It is the one part of
// the purchase that is about a journey already finished.
//
// It renders NOTHING when there is no token and no stray callback, so an ordinary visit does
// not carry an empty panel around. The router's search params are the source of truth -
// `location.search` would be read once and never again.
import { Check, Copy, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { client } from '../lib/api.ts';
import type { Receipt } from '../../../server/src/contract/index.ts';
import { CONTACT } from '../lib/content.ts';
import { toman } from '../lib/format.ts';
import { useToasts } from '../ui/toast.tsx';
import Button from '../ui/button.tsx';
import CodeCapsule from './code-capsule.tsx';

export default function PurchaseResult(): ReactNode
{
    const [params, setParams] = useSearchParams();
    const notify = useToasts();

    const token = params.get('receipt') ?? '';
    const strayCallback = params.get('pay') === 'unknown';

    // undefined while unknown, null once we know there is nothing to show.
    const [receipt, setReceipt] = useState<Receipt | null | undefined>(undefined);
    const [receiptFailed, setReceiptFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    // The reset timer is tracked so unmounting cancels it. Left alone, a panel that goes away
    // within two seconds of a copy still fires a write into a component that is gone.
    const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(copyTimer.current), []);

    useEffect(() =>
    {
        if (token === '')
        {
            return;
        }
        let current = true;
        setReceipt(undefined);
        setReceiptFailed(false);
        client.pay.receipt({ query: { token } })
            .then((value) => { if (current) { setReceipt(value); } })
            .catch(() => { if (current) { setReceiptFailed(true); } });
        // A second token arriving before the first answer would otherwise land out of order.
        return () => { current = false; };
    }, [token]);

    const startOver = (): void =>
    {
        setReceipt(undefined);
        setReceiptFailed(false);
        setParams({}, { replace: true });
    };

    const copyCode = async (code: string): Promise<void> =>
    {
        try
        {
            await navigator.clipboard.writeText(code);
            // The confirmation stays ON the button rather than in a toast: the reader's eye
            // is already there, and a notice in the corner of the screen would be further
            // from the action than the action itself.
            setCopied(true);
            clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        }
        catch
        {
            // A refused clipboard is the one case worth a notice - the button would
            // otherwise say nothing at all and the buyer would assume the code was taken.
            notify.error('کپی نشد. کد را دستی انتخاب کنید؛ کد شما همان است که می‌بینید.');
        }
    };

    if (token === '' && !strayCallback)
    {
        return null;
    }

    return (
        <section id="purchase" className="mx-auto max-w-3xl scroll-mt-20 px-4 pt-section sm:px-5">
            <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
                { strayCallback && (
                    <>
                        <h2 className="font-bold">این پرداخت پیدا نشد</h2>
                        <p className="mt-3 text-small text-muted">
                            سفارشی با این مشخصات نداریم. اگر مبلغی از حساب شما کم شده، با پشتیبانی تماس بگیرید تا بررسی کنیم.
                        </p>
                        <Button className="mt-5" onClick={ startOver }>بازگشت به خرید</Button>
                    </>
                ) }

                { !strayCallback && receiptFailed && (
                    <>
                        <h2 className="font-bold">نتیجهٔ پرداخت در دسترس نیست</h2>
                        <p className="mt-3 text-small text-muted">
                            نتوانستیم وضعیت این سفارش را بخوانیم. صفحه را دوباره باز کنید؛ اگر باز هم نشد با پشتیبانی تماس بگیرید.
                        </p>
                        <p className="mt-2 text-small text-muted">
                            <span dir="ltr" className="latin">{ CONTACT.phone }</span>
                        </p>
                    </>
                ) }

                { !strayCallback && !receiptFailed && receipt === undefined && (
                    <p className="text-small text-muted">در حال بررسی نتیجهٔ پرداخت...</p>
                ) }

                { receipt?.outcome === 'paid' && receipt.code !== null && (
                    <>
                        <div className="flex items-center gap-2 text-firouze">
                            <ShieldCheck className="size-5" aria-hidden="true"/>
                            <h2 className="font-bold">پرداخت تأیید شد</h2>
                        </div>
                        <p className="mt-2 text-small text-muted">
                            این کد شماست. تا آن را جایی ذخیره نکرده‌اید صفحه را نبندید.
                        </p>

                        <div className="mt-5">
                            <CodeCapsule code={ receipt.code } label="کد گیفت کارت شما" verified/>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-3">
                            <Button
                                variant="primary"
                                glyph={ copied ? Check : Copy }
                                onClick={ () => void copyCode(receipt.code ?? '') }
                            >
                                { copied ? 'کپی شد' : 'کپی کردن کد' }
                            </Button>
                            <Button onClick={ startOver }>خرید کارت دیگر</Button>
                        </div>

                        <dl className="mt-6 grid gap-2 text-caption text-muted">
                            <div className="flex gap-2">
                                <dt>شمارهٔ پیگیری:</dt>
                                <dd dir="ltr" className="latin">{ String(receipt.refId ?? '-') }</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt>پرداخت‌شده:</dt>
                                <dd>{ toman(receipt.toman) } تومان</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt>شمارهٔ موبایل:</dt>
                                <dd dir="ltr" className="latin">{ receipt.phone }</dd>
                            </div>
                        </dl>

                        <p className="mt-4 text-caption text-muted">
                            { receipt.smsDelivered
                                ? 'یک نسخه از این کد با پیامک هم برایتان ارسال شد.'
                                : 'پیامک ارسال نشد، اما کد شما همین است و معتبر است. آن را همین‌جا کپی کنید.' }
                        </p>
                    </>
                ) }

                {/* Money verified, nothing left to hand over. Saying "successful" and showing
                    no code would be worse than useless, so this state says what happened. */}
                { receipt?.outcome === 'paid' && receipt.code === null && (
                    <>
                        <div className="flex items-center gap-2 text-gold">
                            <TriangleAlert className="size-5" aria-hidden="true"/>
                            <h2 className="font-bold">پرداخت شما تأیید شد، اما کد آماده نیست</h2>
                        </div>
                        <p className="mt-3 text-small text-muted">
                            مبلغ از حساب شما کم شده و سفارشتان ثبت است، ولی موجودی کد این کارت همان لحظه تمام شد.
                            با شمارهٔ پیگیری زیر با پشتیبانی تماس بگیرید: یا کد را می‌فرستیم یا کل مبلغ را برمی‌گردانیم.
                        </p>
                        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
                            <p className="text-caption text-muted">شمارهٔ پیگیری</p>
                            <p dir="ltr" className="latin mt-1 text-start text-lg font-semibold">{ String(receipt.refId ?? '-') }</p>
                        </div>
                        <p className="mt-3 text-small">
                            <span dir="ltr" className="latin">{ CONTACT.phone }</span>
                        </p>
                    </>
                ) }

                { receipt?.outcome === 'cancelled' && (
                    <>
                        <h2 className="font-bold">پرداخت لغو شد</h2>
                        <p className="mt-3 text-small text-muted">
                            مبلغی از حساب شما کم نشده است. هر وقت خواستید دوباره امتحان کنید.
                        </p>
                        <Button variant="primary" className="mt-5" onClick={ startOver }>تلاش دوباره</Button>
                    </>
                ) }

                { receipt?.outcome === 'failed' && (
                    <>
                        <h2 className="font-bold">پرداخت تأیید نشد</h2>
                        <p className="mt-3 text-small text-muted">
                            بانک این تراکنش را تأیید نکرد. اگر مبلغی از حساب شما کم شده باشد، طبق روال بانکی تا ۷۲ ساعت
                            برمی‌گردد. برای پیگیری با پشتیبانی تماس بگیرید.
                        </p>
                        <p className="mt-2 text-small">
                            <span dir="ltr" className="latin">{ CONTACT.phone }</span>
                        </p>
                        <Button className="mt-5" onClick={ startOver }>تلاش دوباره</Button>
                    </>
                ) }
            </div>
        </section>
    );
}
