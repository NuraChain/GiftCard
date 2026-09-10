// The catalogue a first boot starts from.
//
// This runs ONCE, when the tiers table is empty. After that the console owns the catalogue
// and this file is never read again - which is why editing it does not change a running
// shop, and why it is a seed rather than configuration.
//
// The copy lives here rather than in the application because the shop renders its cards from
// the database. A tier added next month needs its own words, and words that only exist in a
// bundled TypeScript file cannot be written by an operator.
import type { TierInput } from '../db/index.ts';

/**
 * The three denominations the shop opens with, in display order.
 *
 * The prices live HERE rather than in the environment because they are part of the same
 * one-time seed as the words beside them - splitting them meant an operator had to look in
 * two places to answer "what does a fresh install sell?", and one of those places kept
 * three variables that were read exactly once and then never again.
 */
export function seedTiers(): TierInput[] {
    return [
        {
            amount: 5,
            toman: 350_000,
            title: 'کارت پنج دلاری',
            blurb: 'برای امتحان کردن سرویس یا هدیه‌ای کوچک. همان کد و همان تحویل آنی کارت‌های بزرگ‌تر.',
            recommended: false,
            active: true,
            sort: 10
        },
        {
            amount: 10,
            toman: 700_000,
            title: 'کارت ده دلاری',
            blurb: 'رایج‌ترین انتخاب: اندازه‌ای که برای بیشتر خریدها کافی است و ته‌مانده‌ای باقی نمی‌گذارد.',
            recommended: true,
            active: true,
            sort: 20
        },
        {
            amount: 25,
            toman: 1_750_000,
            title: 'کارت بیست و پنج دلاری',
            blurb: 'برای استفاده طولانی‌تر یا هدیه دادن. یک کد، بدون تاریخ انقضا.',
            recommended: false,
            active: true,
            sort: 30
        }
    ];
}
