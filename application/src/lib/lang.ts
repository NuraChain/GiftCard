// Which language the reader is in, and which shop that puts them in.
//
// THE LANGUAGE IS IN THE ADDRESS, not in storage or a cookie: `/` is Persian and `/en`,
// `/ar`, `/fr`... are the others. So a link can be shared in any of them, a refresh keeps it,
// and Plisio's page can send a buyer back to their own language without this app remembering
// anything for them.
//
// A LANGUAGE IS NOT A SHOP (server: domain/langs.ts). Persian is the Toman shop - an Iranian
// gateway, a mobile number, an SMS. Every other language is the one dollar shop - Plisio, an
// email, Resend - in other words. So the purchase code asks `shopOf`, the layout asks `dirOf`,
// and neither ever asks "is this English".
//
// The console is Persian only, and lives outside all of this.
import { useLocation } from 'react-router';

import { INTL_LANGS, LANGS, type IntlLang, type Lang } from '../../../server/src/contract/index.ts';

export { INTL_LANGS, LANGS, type IntlLang, type Lang };

export type Shop = 'toman' | 'dollar';

export interface LangInfo {
    /** The language's name in itself - the switcher's whole point is a reader who cannot read this page. */
    name: string;
    dir: 'ltr' | 'rtl';

    /** The `lang` attribute, and what `Intl` formats with. */
    locale: string;

    /** The file in /public/flags. One country per language - see the note on each. */
    flag: string;
}

export const LANG_INFO: Record<Lang, LangInfo> = {
    // US rather than UK: the shop is priced in US dollars and formats as en-US.
    en: { name: 'English', dir: 'ltr', locale: 'en-US', flag: 'us' },
    fa: { name: 'فارسی', dir: 'rtl', locale: 'fa-IR', flag: 'ir' },
    ar: { name: 'العربية', dir: 'rtl', locale: 'ar', flag: 'sa' },
    es: { name: 'Español', dir: 'ltr', locale: 'es', flag: 'es' },
    // Brazil, and the copy is written in Brazilian Portuguese to match.
    pt: { name: 'Português', dir: 'ltr', locale: 'pt-BR', flag: 'br' },
    hi: { name: 'हिन्दी', dir: 'ltr', locale: 'hi-IN', flag: 'in' },
    // Simplified script, so mainland China.
    zh: { name: '中文', dir: 'ltr', locale: 'zh-CN', flag: 'cn' },
    ru: { name: 'Русский', dir: 'ltr', locale: 'ru', flag: 'ru' },
    fr: { name: 'Français', dir: 'ltr', locale: 'fr', flag: 'fr' },
    tr: { name: 'Türkçe', dir: 'ltr', locale: 'tr', flag: 'tr' }
};

/** The language a path belongs to: `/ar` and anything under it is Arabic; the rest is Persian. */
export function langOf(pathname: string): Lang {
    const first = pathname.split('/')[1] ?? '';
    return (LANGS as readonly string[]).includes(first) && first !== 'fa' ? (first as Lang) : 'fa';
}

/** The current language, from the router - so it changes when the address does. */
export function useLang(): Lang {
    return langOf(useLocation().pathname);
}

/** Where a language's landing page lives. Persian keeps the bare root it always had. */
export function homeOf(lang: Lang): string {
    return lang === 'fa' ? '/' : `/${lang}`;
}

/** How a language's reader pays. */
export function shopOf(lang: Lang): Shop {
    return lang === 'fa' ? 'toman' : 'dollar';
}

export function dirOf(lang: Lang): 'ltr' | 'rtl' {
    return LANG_INFO[lang].dir;
}

/**
 * One component's words in every language, and the one the reader is in.
 *
 * Copy is kept beside the component that shows it rather than in one global dictionary: the
 * languages are read and edited together, and a string that has lost a translation is a
 * type error rather than a blank on the page.
 */
export function useCopy<T>(copy: Record<Lang, T>): T {
    return copy[useLang()];
}

/**
 * The same, for words only the dollar shop shows - a Persian page never reaches them, so they
 * have no Persian half. Should one render there anyway, it reads in English.
 */
export function useDollarCopy<T>(copy: Record<IntlLang, T>): T {
    const lang = useLang();
    return copy[lang === 'fa' ? 'en' : lang];
}
