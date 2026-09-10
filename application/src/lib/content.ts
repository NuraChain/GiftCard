// The page copy that is NOT the catalogue.
//
// The cards live in the database, because the operator can add and reprice denominations
// from the console, and words that only exist in a bundled TypeScript file cannot be written
// by an operator. `server/src/domain/seed.ts` holds what a first boot starts from; after that
// the console owns them.
//
// What stays here is copy that describes the SERVICE rather than the products: the steps, the
// promises, the questions, and the contact details.
//
// MOCK DATA: the values in CONTACT are stand-ins so the page reads as a finished product.
// They are listed in the README under "Replace before launch".
//
// The line that does NOT move: contact details are replaceable content, invented CREDENTIALS
// are not. Nothing here claims a review count, a rating, a testimonial, a certification, a
// badge, or a customer total - a gift-card site that manufactures its own trust signals is
// doing exactly what a scam site does.
import { Infinity as InfinityIcon, Lock, RefreshCw, Zap, CreditCard, ShieldCheck, MessageSquareText, type LucideIcon } from 'lucide-react';

export interface Step
{
    glyph: LucideIcon;
    title: string;
    body: string;
}

/** Purchase to working code. These are ordered - the numbering carries real meaning. */
export const STEPS: Step[] =
[
    {
        glyph: CreditCard,
        title: 'کارت را انتخاب کنید',
        body: 'مبلغ را انتخاب می‌کنید و شماره موبایلتان را روی همان کارت وارد می‌کنید. حسابی نمی‌سازید و رمزی تعیین نمی‌کنید.'
    },
    {
        glyph: ShieldCheck,
        title: 'پرداخت را انجام می‌دهید',
        body: 'به درگاه زرین‌پال می‌روید و پرداخت را همان‌جا انجام می‌دهید. اطلاعات کارت بانکی شما هرگز به سرور ما نمی‌رسد.'
    },
    {
        glyph: MessageSquareText,
        title: 'کد را همان لحظه می‌گیرید',
        body: 'به محض تأیید پرداخت، کد روی صفحه نمایش داده می‌شود و همزمان با پیامک به همان شماره ارسال می‌شود.'
    }
];

export interface Assurance
{
    glyph: LucideIcon;

    /** Two or three words - long enough to mean something, short enough not to wrap. */
    label: string;

    /** The one line that makes the label a commitment rather than a slogan. */
    detail: string;
}

/**
 * The hero's four promises. These are the page's primary trust signal, so each one is
 * a commitment the operator has to keep - not a decorative feature bullet.
 */
export const ASSURANCES: Assurance[] =
[
    { glyph: Zap, label: 'تحویل آنی', detail: 'روی صفحه و با پیامک' },
    { glyph: RefreshCw, label: 'ضمانت بازگشت وجه', detail: 'اگر کد فعال نشود' },
    { glyph: Lock, label: 'بدون ذخیره کارت', detail: 'پرداخت فقط روی درگاه' },
    { glyph: InfinityIcon, label: 'بدون تاریخ انقضا', detail: 'هر وقت خواستید فعال کنید' }
];

export interface Faq
{
    id: string;
    question: string;
    answer: string;
}

/** The questions a cautious buyer actually asks before paying. */
export const FAQS: Faq[] =
[
    {
        id: 'delivery',
        question: 'کد چه زمانی به دستم می‌رسد؟',
        answer: 'بلافاصله پس از تأیید پرداخت. کد روی همان صفحه نمایش داده می‌شود و یک نسخه هم با پیامک به شماره‌ای که وارد کرده‌اید می‌رسد. تا کد را جایی ذخیره نکرده‌اید، صفحه را نبندید.'
    },
    {
        id: 'no-sms',
        question: 'اگر پرداخت انجام شود ولی پیامک نرسد؟',
        answer: 'کد شما از بین نمی‌رود. پیامک فقط یک نسخهٔ کمکی است؛ کد اصلی همان است که روی صفحه می‌بینید. اگر صفحه را بسته‌اید، با شمارهٔ پیگیری با پشتیبانی تماس بگیرید تا همان کد را دوباره برایتان بفرستیم.'
    },
    {
        id: 'reference',
        question: 'شمارهٔ پیگیری به چه درد می‌خورد؟',
        answer: 'شمارهٔ پیگیری همان کد رهگیری تراکنش در بانک است. اگر پولی از حساب شما کم شد و کدی نگرفتید، با اعلام همین شماره سفارش شما را پیدا می‌کنیم؛ یا کد را می‌دهیم یا وجه را برمی‌گردانیم.'
    },
    {
        id: 'not-working',
        question: 'اگر کد کار نکند چه می‌شود؟',
        answer: 'کد را برای پشتیبانی بفرستید. اگر کد مصرف‌نشده باشد و فعال نشود، یا کد جایگزین می‌دهیم یا کل مبلغ را برمی‌گردانیم. انتخاب با شماست.'
    },
    {
        id: 'refund',
        question: 'امکان بازگشت وجه وجود دارد؟',
        answer: 'بله، تا زمانی که کد استفاده نشده باشد. کدی که یک بار مصرف شده قابل بازگشت نیست، چون دیگر ارزشی برای فروشنده ندارد. این محدودیت را پیش از پرداخت می‌گوییم، نه بعد از آن.'
    },
    {
        id: 'payment-data',
        question: 'اطلاعات پرداخت من ذخیره می‌شود؟',
        answer: 'خیر. پرداخت روی درگاه زرین‌پال انجام می‌شود و شماره کارت بانکی شما وارد سرور ما نمی‌شود. آنچه نزد ما می‌ماند شماره موبایل و سابقه سفارش است تا بتوانیم پشتیبانی کنیم.'
    },
    {
        id: 'expiry',
        question: 'کارت تاریخ انقضا دارد؟',
        answer: 'خیر. کد پس از خرید منقضی نمی‌شود و هر زمان که خواستید می‌توانید آن را فعال کنید.'
    },
    {
        id: 'gift',
        question: 'می‌توانم کارت را به کسی هدیه بدهم؟',
        answer: 'بله. کد به دارنده آن تعلق دارد، پس کافی است آن را برای فرد مورد نظر بفرستید. فقط تا وقتی کد را فعال نکرده‌اید آن را جای امنی نگه دارید.'
    }
];

/** Support and identity. MOCK VALUES - see the README's "Replace before launch". */
export const CONTACT =
{
    email: 'support@guardian-service.ir',
    telegram: '@guardian_service_support',
    phone: '+98 21 9100 4477',
    hours: 'هر روز، ۹ صبح تا ۹ شب به وقت تهران',
    operator: 'شرکت داده‌پردازی گاردین سرویس'
};
