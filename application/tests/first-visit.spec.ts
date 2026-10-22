// Where a first arrival at the bare address is sent - see src/lib/first-visit.ts.
//
// The case that matters most is the one that must NOT move: a buyer coming back from the bank
// to `/?receipt=...` has paid in the Persian shop, and sending them anywhere else would show
// them a receipt page in a shop they did not pay in.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { browserLang, rememberLang, settleFirstVisit } from '../src/lib/first-visit.ts';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

/** The server's answer to /api/pay/locale: the country's language, or null. */
function country(lang: string | null): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(json({ lang })))
    );
}

function arriveAt(url: string): void {
    window.history.replaceState(null, '', url);
}

function browserAsks(languages: string[]): void {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

beforeEach(() => {
    localStorage.clear();
    arriveAt('/');
    browserAsks([]);
    country(null);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a first arrival at the bare address', () => {
    it("goes to the visitor's country's language", async () => {
        country('tr');
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/tr');
    });

    it('stays Persian for a visitor from Iran', async () => {
        country('fa');
        browserAsks(['en-US']);
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/');
    });

    it("falls back to the browser's language when the country says nothing", async () => {
        browserAsks(['de-DE', 'pt-BR', 'en']);
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/pt');
    });

    it('falls back to English when nothing else does', async () => {
        browserAsks(['de-DE']);
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/en');
    });

    it('falls back when the country lookup fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new TypeError('offline')))
        );
        browserAsks(['fr-FR']);
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/fr');
    });

    it('opens in the language the visitor last read, before asking anybody', async () => {
        rememberLang('ar');
        country('tr');
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/ar');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('stays Persian for a visitor who chose Persian', async () => {
        rememberLang('fa');
        browserAsks(['en-US']);
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/');
    });
});

describe('everything else', () => {
    it('leaves a buyer coming back from the bank exactly where they are', async () => {
        country('en');
        arriveAt('/?receipt=abc');
        await settleFirstVisit();
        expect(window.location.pathname + window.location.search).toBe('/?receipt=abc');
    });

    it('leaves a link to another language, a deep link and the console alone', async () => {
        country('tr');
        for (const url of ['/en', '/#cards', '/admin']) {
            arriveAt(url);
            await settleFirstVisit();
            expect(window.location.pathname + window.location.hash, url).toBe(url);
        }
    });

    it('leaves a crawler on the Persian page', async () => {
        country('en');
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (compatible; Googlebot/2.1)'
        );
        await settleFirstVisit();
        expect(window.location.pathname).toBe('/');
    });
});

describe("the browser's language", () => {
    it('is read by its primary tag', () => {
        expect(browserLang(['zh-TW'])).toBe('zh');
        expect(browserLang(['FA-ir'])).toBe('fa');
        expect(browserLang(['de', 'nl'])).toBeNull();
    });
});
