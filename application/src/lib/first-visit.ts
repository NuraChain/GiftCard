// Which language a visitor who arrives at the bare address sees.
//
// `/` is the Persian shop, and it stays the address of the Persian shop. What changes is the
// FIRST arrival: somebody typing the domain from Madrid should not have to find the language
// menu before they can read the page. So, before the app mounts, an arrival at exactly `/`
// is sent to the page in the visitor's language, judged in this order:
//
//   1. the language they last read the shop in, remembered on this device;
//   2. the language of the country they are in, when the edge in front of the server says
//      which country that is (server: GET /api/pay/locale);
//   3. the first language their browser asks for that the shop has;
//   4. English.
//
// NOTHING ELSE IS REDIRECTED. A link to `/en` is a choice somebody made; `/?receipt=...` is a
// buyer coming back from the bank to the Persian shop they paid in; `/#cards` is a deep link.
// Each of those is left exactly where it points - a buyer must never land on a receipt page
// in a shop they did not pay in. Crawlers are left alone too, so the Persian page is still
// what a search engine finds at `/`.
import { client } from './api.ts';
import { homeOf, LANGS, type Lang } from './lang.ts';

const KEY = 'ashbringer-lang';

/** How long the country lookup may hold the first paint before the browser's language decides. */
const LOOKUP_MS = 1500;

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly/i;

function isLang(value: unknown): value is Lang {
    return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Remembers the language the visitor is reading, so the bare address opens in it next time. */
export function rememberLang(lang: Lang): void {
    try {
        localStorage.setItem(KEY, lang);
    } catch {
        // No storage: the next visit is judged afresh, which is still a sensible answer.
    }
}

function rememberedLang(): Lang | null {
    try {
        const stored = localStorage.getItem(KEY);
        return isLang(stored) ? stored : null;
    } catch {
        return null;
    }
}

/** The first language the browser asks for that the shop has: `pt-BR` is Portuguese, `zh-TW` Chinese. */
export function browserLang(tags: readonly string[]): Lang | null {
    for (const tag of tags) {
        const primary = tag.toLowerCase().split('-')[0];
        if (isLang(primary)) {
            return primary;
        }
    }
    return null;
}

/** The country's language, or null when the server cannot tell or does not answer in time. */
async function countryLang(): Promise<Lang | null> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_MS));
    const lookup = client.pay
        .locale()
        .then((answer) => answer.lang)
        .catch(() => null);
    return Promise.race([lookup, timeout]);
}

/**
 * Sends a first arrival at `/` to the visitor's language. Runs before the app mounts, so the
 * router starts on the right page and nobody sees the Persian page flash first.
 */
export async function settleFirstVisit(): Promise<void> {
    const { pathname, search, hash } = window.location;
    if (pathname !== '/' || search !== '' || hash !== '' || BOTS.test(navigator.userAgent)) {
        return;
    }

    const lang =
        rememberedLang() ??
        (await countryLang()) ??
        browserLang(navigator.languages ?? [navigator.language]) ??
        'en';

    if (lang !== 'fa') {
        window.history.replaceState(null, '', homeOf(lang));
    }
}
