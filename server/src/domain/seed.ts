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
 * NO PRICES. There is nothing to seed: a card costs its dollar figure times the tether
 * rate times the shop's margin, so the only price-shaped decision on a fresh install is that
 * margin, and it has its own default in the settings module. What is seeded here is the part
 * a rate cannot supply - which denominations exist and what each one says about itself.
 */
export function seedTiers(): TierInput[] {
    return [
        {
            amount: 5,
            title: 'کارت پنج دلاری',
            blurb: 'برای امتحان کردن سرویس یا هدیه‌ای کوچک. همان کد و همان تحویل آنی کارت‌های بزرگ‌تر.',
            recommended: false,
            active: true,
            sort: 10
        },
        {
            amount: 10,
            title: 'کارت ده دلاری',
            blurb: 'رایج‌ترین انتخاب: اندازه‌ای که برای بیشتر خریدها کافی است و ته‌مانده‌ای باقی نمی‌گذارد.',
            recommended: true,
            active: true,
            sort: 20
        },
        {
            amount: 25,
            title: 'کارت بیست و پنج دلاری',
            blurb: 'برای استفاده طولانی‌تر یا هدیه دادن. یک کد، بدون تاریخ انقضا.',
            recommended: false,
            active: true,
            sort: 30
        }
    ];
}
