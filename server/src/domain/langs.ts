// The languages the shop is read in.
//
// TWO DIFFERENT THINGS, kept apart on purpose. A LANGUAGE is what the page is written in; a
// SHOP is how it is paid. Persian is the Toman shop - an Iranian gateway, a mobile number,
// an SMS. Every other language is the same dollar shop - NOWPayments, an email, Resend - in other
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
 * The language a visitor from each country most likely reads, for a FIRST visit only - see
 * `langOfCountry`. Countries are ISO 3166-1 alpha-2 codes, upper case. A country missing here
 * is not a mistake: its visitors fall through to their browser's language, then to English.
 */
const COUNTRY_LANGS: Record<string, Lang> = {
    // Persian: Iran, and Afghanistan and Tajikistan, whose Dari and Tajik readers read it.
    IR: 'fa',
    AF: 'fa',
    TJ: 'fa',
    // Arabic.
    SA: 'ar',
    AE: 'ar',
    IQ: 'ar',
    KW: 'ar',
    QA: 'ar',
    BH: 'ar',
    OM: 'ar',
    YE: 'ar',
    JO: 'ar',
    SY: 'ar',
    LB: 'ar',
    PS: 'ar',
    EG: 'ar',
    LY: 'ar',
    TN: 'ar',
    DZ: 'ar',
    MA: 'ar',
    SD: 'ar',
    // Spanish.
    ES: 'es',
    MX: 'es',
    AR: 'es',
    CO: 'es',
    CL: 'es',
    PE: 'es',
    VE: 'es',
    EC: 'es',
    GT: 'es',
    CU: 'es',
    BO: 'es',
    DO: 'es',
    HN: 'es',
    PY: 'es',
    SV: 'es',
    NI: 'es',
    CR: 'es',
    PA: 'es',
    UY: 'es',
    // Portuguese.
    BR: 'pt',
    PT: 'pt',
    AO: 'pt',
    MZ: 'pt',
    // Hindi.
    IN: 'hi',
    // Simplified Chinese.
    CN: 'zh',
    SG: 'zh',
    // Russian.
    RU: 'ru',
    BY: 'ru',
    KZ: 'ru',
    KG: 'ru',
    // French.
    FR: 'fr',
    BE: 'fr',
    LU: 'fr',
    MC: 'fr',
    SN: 'fr',
    CI: 'fr',
    // Turkish.
    TR: 'tr',
    CY: 'tr'
};

/** The language for a visitor's country, or null when the country says nothing useful. */
export function langOfCountry(country: string): Lang | null {
    return COUNTRY_LANGS[country.trim().toUpperCase()] ?? null;
}

/** The English name when the admin has set none: a Persian name on a Latin page reads as a bug. */
export const DEFAULT_ENGLISH_NAME = 'Ashbringer';

/**
 * What the shop is called in a language: its own name if one is set, else the English one,
 * else `DEFAULT_ENGLISH_NAME`. Only the Persian page shows the Persian name.
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
    return english === '' ? DEFAULT_ENGLISH_NAME : english;
}
