// The languages the shop is read in.
//
// TWO DIFFERENT THINGS, kept apart on purpose. A LANGUAGE is what the page is written in; a
// SHOP is how it is paid. Persian is the Toman shop - an Iranian gateway, a mobile number,
// an SMS. Every other language is the same dollar shop - Plisio, an email, Resend - in other
// words. So an order records its shop (`Order.lang`, 'fa' | 'en'), never the language, and
// everything on the server that branches on how a payment is settled keeps two cases.
//
// Client-safe: imported by the contract, so by the browser too.

/** Every language, in the order the switcher lists them. */
export const LANGS = ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'] as const;

export type Lang = (typeof LANGS)[number];

/** The languages the dollar shop is read in - all but Persian. */
export const INTL_LANGS = ['en', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'] as const;

export type IntlLang = (typeof INTL_LANGS)[number];

/** The shop's name in each dollar-shop language. An empty one falls back - see `shopName`. */
export type ShopNames = Record<IntlLang, string>;

export const NO_SHOP_NAMES: ShopNames = {
    en: '',
    ar: '',
    es: '',
    pt: '',
    hi: '',
    zh: '',
    ru: '',
    fr: '',
    tr: ''
};

/**
 * What the shop is called in a language: its own name if one is set, else the English one,
 * else the Persian one - which is always set, and is the brand the shop started with.
 */
export function shopName(lang: Lang, persian: string, names: ShopNames): string {
    if (lang === 'fa') {
        return persian;
    }
    const own = names[lang].trim();
    if (own !== '') {
        return own;
    }
    const english = names.en.trim();
    return english === '' ? persian : english;
}
