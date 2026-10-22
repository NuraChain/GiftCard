// Component tests against real DOM (happy-dom) through the same build pipeline that serves
// the app. `App` takes a `url` so a test can pin the route without an address bar.
//
// The catalogue is fetched, so `fetch` is stubbed here rather than left to hit a server that
// is not running. What each test asserts is what the page does with an answer - or, in the
// first one, what it does while there is not one yet.
//
// PRICES COME DOWN WITHOUT THE RATE BEHIND THEM. The shop used to publish the tether rate it
// priced from; that rate is set by hand in the console now, so it is an internal setting and
// the storefront no longer shows it. The tests that matter most here are the ones where a
// price is MISSING: a shop that cannot price has to refuse to be bought rather than offer a
// figure, and that is a state no amount of retrying reaches on a live server.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import App from '../src/App.tsx';
import { FAQS, ASSURANCES, ENAMAD } from '../src/lib/content.ts';

/** 10 x 100,000 + 6% = 1,060,000 - the same sum the server does, written out for the reader. */
const TEN_DOLLAR_TOMAN = 1_060_000;

function catalogBody(overrides: { toman?: number | null } = {}): Record<string, unknown> {
    return {
        appName: 'اشبرینگر',
        appNames: {
            en: 'Ashbringer',
            ar: '',
            es: '',
            pt: '',
            hi: '',
            zh: '',
            ru: '',
            fr: 'Boutique',
            tr: ''
        },
        tiers: [
            {
                amount: 10,
                toman: 'toman' in overrides ? overrides.toman : TEN_DOLLAR_TOMAN,
                available: 4,
                title: 'خرید گیفت کارت نورا ۱۰ دلاری',
                blurb: 'رایج‌ترین انتخاب.',
                titleEn: 'Nura $10 gift card',
                blurbEn: 'The usual choice.',
                recommended: true
            }
        ],
        englishOpen: true
    };
}

const CATALOG = catalogBody();

/** JSON in the shape the client's error envelope parser expects. */
function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

beforeEach(() => {
    // One answer for the catalogue, a refusal for anything else - the console's routes are
    // guarded and this suite never signs in.
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string) => {
            if (String(input).includes('/api/pay/catalog')) {
                return Promise.resolve(json(CATALOG));
            }
            return Promise.resolve(json({}, 401));
        })
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('landing page', () => {
    it('the card section always says something, catalogue or no catalogue', () => {
        // The denominations are not a constant a test could assert against - the catalogue is
        // editable and fetched at runtime. What must still hold is that the section is never
        // BLANK: skeleton, error, "nothing for sale", or the cards themselves. A silent empty
        // region reads as a broken shop.
        const { container } = render(<App url="/" />);
        const cards = container.querySelector('#cards');

        expect(cards).not.toBeNull();
        expect(cards?.textContent).toContain('کارت خود را انتخاب کنید');
        const region = cards?.querySelector('.mt-stack');
        expect((region?.textContent ?? '') + (region?.innerHTML ?? '')).not.toBe('');
    });

    it('shows every FAQ answer in the markup, so the page reads without opening each row', () => {
        const { container } = render(<App url="/" />);
        for (const faq of FAQS.fa) {
            expect(container.textContent, faq.id).toContain(faq.question);
            expect(container.textContent, faq.id).toContain(faq.answer);
        }
    });

    it('the FAQ accordion toggles aria-expanded and the panel', () => {
        const { container } = render(<App url="/" />);
        const first = FAQS.fa[0].id;
        const button = container.querySelector<HTMLButtonElement>(`#faq-button-${first}`);
        const panel = container.querySelector<HTMLElement>(`#faq-panel-${first}`);

        // The first row starts open, so the section never renders as a wall of closed rows.
        expect(button?.getAttribute('aria-expanded')).toBe('true');
        expect(panel?.hasAttribute('hidden')).toBe(false);

        fireEvent.click(button as HTMLButtonElement);
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        expect(panel?.hasAttribute('hidden')).toBe(true);
    });

    it('isolates every Latin run so it cannot scramble the Persian layout', () => {
        const { container } = render(<App url="/" />);
        // Prices, sample codes, and the mobile number are Latin inside RTL prose: each must carry its
        // own direction or bidi reorders the surrounding sentence.
        for (const node of container.querySelectorAll('.latin')) {
            expect(node.getAttribute('dir'), node.textContent ?? '').toBe('ltr');
        }
    });

    it('the mobile nav trigger exposes string aria-expanded and toggles its panel', () => {
        const { container } = render(<App url="/" />);
        const trigger = container.querySelector<HTMLButtonElement>(
            '[aria-controls="mobile-nav-panel"]'
        );

        // The string form matters: a boolean renders as a bare attribute that announces
        // nothing.
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('#mobile-nav-panel')).toBeNull();

        fireEvent.click(trigger as HTMLButtonElement);
        expect(trigger?.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('#mobile-nav-panel')).not.toBeNull();
    });

    it('the theme control cycles light -> dark -> system and names the NEXT mode', () => {
        const { container } = render(<App url="/" />);
        const button = container.querySelector<HTMLButtonElement>(
            '[title^="تغییر پوسته"]'
        ) as HTMLButtonElement;

        // Default is system, so the first click offers light.
        expect(button.getAttribute('aria-label')).toContain('روشن');
        fireEvent.click(button);
        expect(button.getAttribute('aria-label')).toContain('تاریک');
        fireEvent.click(button);
        expect(button.getAttribute('aria-label')).toContain('پیروی از سیستم');
        fireEvent.click(button);
        expect(button.getAttribute('aria-label')).toContain('روشن');
    });

    it('every hero assurance carries a glyph', () => {
        const { container } = render(<App url="/" />);
        for (const item of ASSURANCES.fa) {
            expect(container.textContent, item.label).toContain(item.label);
            expect(container.textContent, item.detail).toContain(item.detail);
        }
        // Lucide renders real <svg>; the icons are decorative and must stay hidden.
        const decorative = [...container.querySelectorAll('svg')];
        expect(decorative.length).toBeGreaterThan(0);
        for (const svg of decorative) {
            expect(svg.getAttribute('aria-hidden')).toBe('true');
        }
    });

    it('never applies tracking to Persian text (it would break letter joining)', () => {
        const { container } = render(<App url="/" />);
        const tracked = [...container.querySelectorAll('[class*="tracking-"]')].filter(
            (node) => !node.classList.contains('latin')
        );
        expect(tracked.map((node) => node.className)).toEqual([]);
    });

    it('carries the eNamad seal with the referrer its licence check depends on', () => {
        const { container } = render(<App url="/" />);
        const image = container.querySelector<HTMLImageElement>('img[src*="trustseal.enamad.ir"]');
        const link = image?.closest('a');

        // enamad serves a valid seal only to the domain it licensed, and it decides that from
        // the Referer header. Both halves have to send it - and the outbound link must NOT
        // pick up the `noreferrer` that usually accompanies target="_blank", or a click lands
        // at enamad with nothing to check. This is the kind of attribute a later tidy-up
        // deletes as boilerplate, so it is pinned here.
        expect(image?.getAttribute('referrerpolicy')).toBe('origin');
        expect(link?.getAttribute('referrerpolicy')).toBe('origin');
        expect(link?.getAttribute('rel')).toBe('noopener');
        expect(link?.getAttribute('href')).toContain(ENAMAD.code);

        // Non-standard, and what enamad's own checker looks for on the page.
        expect(image?.getAttribute('code')).toBe(ENAMAD.code);
    });
});

describe('buying from a card', () => {
    it('puts a mobile input on every card and no purchase form at the foot of the page', async () => {
        render(<App url="/" />);

        // The catalogue answer arrives on a microtask; the card renders with it.
        const input = await screen.findByLabelText('شماره موبایل');
        expect(input.getAttribute('id')).toBe('phone-10');

        // The card owns the purchase now, so there is exactly one phone field - the one on
        // the card - and no second copy in a panel below.
        expect(screen.getAllByLabelText('شماره موبایل')).toHaveLength(1);
        expect(document.querySelector('#purchase')).toBeNull();
    });

    it('refuses to advance on an address the shared schema rejects', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');

        fireEvent.change(input, { target: { value: 'not-an-address' } });
        // The FORM is submitted rather than the button clicked: happy-dom does not perform a
        // button's implicit submission, so a click here would assert nothing at all.
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // The same rule the server enforces, running in the browser: no confirm step, and
        // the field says why in the buyer's own language.
        expect(screen.queryByText('ویرایش شماره')).toBeNull();
        expect(document.body.textContent).toContain('شماره موبایل معتبر نیست');
    });

    it('reads the address back before it will take money', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');

        fireEvent.change(input, { target: { value: '09121234567' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // A transposed letter in a domain is discovered after the money has moved and looks
        // perfectly fine until then, so the address is read back before the gateway opens.
        expect(screen.getByText('ویرایش شماره')).not.toBeNull();
        expect(document.body.textContent).toContain('09121234567');
    });

    it('sends the price it displayed, so the server can refuse a stale one', async () => {
        const calls: Array<Record<string, unknown>> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string, init?: RequestInit) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(CATALOG));
                }
                if (String(input).includes('/api/pay/start')) {
                    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
                    return Promise.resolve(json({ payUrl: 'https://gateway.test/pay/x' }));
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');
        fireEvent.change(input, { target: { value: '09121234567' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        // Anchored, and scoped to a BUTTON: the confirm step also carries
        // «مبلغ قابل پرداخت» and a line about the gateway, so a loose text match finds three.
        fireEvent.click(await screen.findByRole('button', { name: /^پرداخت/ }));

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        // The figure on the card travels WITH the purchase. It is not the amount - the server
        // charges its own - it is the assertion the server checks it against.
        expect(calls[0].quotedToman).toBe(TEN_DOLLAR_TOMAN);
        expect(calls[0].amount).toBe(10);
        expect(calls[0].phone).toBe('09121234567');
    });

    it('re-quotes rather than erroring when the rate moved under the buyer', async () => {
        const moved = catalogBody({ toman: 1_272_000 });
        let started = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string) => {
                if (String(input).includes('/api/pay/catalog')) {
                    // The second read - the one the card triggers after being refused -
                    // carries the new price.
                    return Promise.resolve(json(started === 0 ? CATALOG : moved));
                }
                if (String(input).includes('/api/pay/start')) {
                    started += 1;
                    return Promise.resolve(
                        json({ error: { code: 'price-changed', message: 'قیمت تغییر کرد' } }, 409)
                    );
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');
        fireEvent.change(input, { target: { value: '09121234567' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        // Anchored, and scoped to a BUTTON: the confirm step also carries
        // «مبلغ قابل پرداخت» and a line about the gateway, so a loose text match finds three.
        fireEvent.click(await screen.findByRole('button', { name: /^پرداخت/ }));

        // A moved price is not a failure and must not be dressed as one: the buyer is told
        // the amount changed, told no money moved, and asked again with the new figure.
        await screen.findByText(/قیمت این کارت به‌روز شد/);
        expect(document.body.textContent).toContain('پولی از حساب شما کم نشده');
        expect(document.body.textContent).not.toContain('شروع پرداخت ممکن نشد');
    });

    /** Presses a card all the way to «پرداخت» against a gateway that answers `refusal`. */
    async function refusedPurchase(refusal: Response): Promise<void> {
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(CATALOG));
                }
                if (String(input).includes('/api/pay/start')) {
                    return Promise.resolve(refusal);
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');
        fireEvent.change(input, { target: { value: '09121234567' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        fireEvent.click(await screen.findByRole('button', { name: /^پرداخت/ }));
    }

    const UNAVAILABLE = { code: 'gateway-unavailable', message: 'درگاه پرداخت در دسترس نیست' };

    it('tells the buyer the gateway is down, and the operator WHY - in the console', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const reason = 'zibal: request failed (code 104: invalid merchant)';
        await refusedPurchase(json({ error: { ...UNAVAILABLE, details: { reason } } }, 503));

        // The card says the sentence the server wrote, and nothing about merchants: the
        // reason is for whoever runs the shop, and the page is not where they read it.
        await screen.findByText('درگاه پرداخت در دسترس نیست');
        expect(document.body.textContent).not.toContain('invalid merchant');

        expect(logged).toHaveBeenCalledWith(
            expect.stringContaining('[checkout]'),
            expect.objectContaining({ status: 503, code: 'gateway-unavailable', reason })
        );
        logged.mockRestore();
    });

    it('says where to find the reason when the server kept it back', async () => {
        // No console session in this browser, so the server sent the sentence and no reason.
        // A blank would read as "there is no reason"; the hint says how to be shown one.
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const hinted = vi.spyOn(console, 'info').mockImplementation(() => {});
        await refusedPurchase(json({ error: UNAVAILABLE }, 503));

        await screen.findByText('درگاه پرداخت در دسترس نیست');
        expect(logged).toHaveBeenCalledTimes(1);
        expect(hinted).toHaveBeenCalledWith(expect.stringContaining('/admin'));
        logged.mockRestore();
        hinted.mockRestore();
    });

    it('says so when the answer is not the shop’s own', async () => {
        // What a CDN does to an origin 502: the body is replaced, so there is no envelope to
        // read. The card can only be generic - but the console says what kind of answer it was.
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const hinted = vi.spyOn(console, 'info').mockImplementation(() => {});
        await refusedPurchase(new Response('error code: 502', { status: 502 }));

        await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
        expect(hinted).toHaveBeenCalledWith(expect.stringContaining('did not come from'));
        logged.mockRestore();
        hinted.mockRestore();
    });
});

describe('the tether rate', () => {
    it('is never shown to the buyer', async () => {
        render(<App url="/" />);
        await screen.findByText(/۱٬۰۶۰٬۰۰۰/);

        // The price is on the page; the number it was computed from is not. It is a console
        // setting now, not a market quote, and publishing it would dress one as the other.
        expect(document.body.textContent).not.toContain('تتر');
        expect(document.body.textContent).not.toContain('۱۰۰٬۰۰۰');
    });

    it('refuses to be bought rather than showing a price it does not have', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(catalogBody({ toman: null })));
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/" />);

        // No last-known number, no zero, no blank: the card says it cannot be priced and the
        // button will not open a payment for a figure nobody stands behind.
        const button = await screen.findByText('قیمت در دسترس نیست');
        expect(button.closest('button')?.hasAttribute('disabled')).toBe(true);
        expect(document.body.textContent).not.toContain('۱٬۰۶۰٬۰۰۰');
    });
});

describe('the English shop', () => {
    it('reads left to right, in English, with its links kept inside /en', async () => {
        const { container } = render(<App url="/en" />);

        expect(await screen.findByText('Choose your card')).not.toBeNull();
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.documentElement.lang).toBe('en-US');
        for (const faq of FAQS.en) {
            expect(container.textContent, faq.id).toContain(faq.answer);
        }

        // «Cards» must not send an English reader into the Persian shop.
        const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toContain('/en#cards');
        expect(hrefs).not.toContain('/#cards');

        // The way back is named in the language it leads to.
        fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
        expect(screen.getByRole('link', { name: /فارسی/ }).getAttribute('href')).toBe('/');
    });

    it('offers the English shop from the Persian one, and puts the document back', async () => {
        render(<App url="/" />);
        await screen.findByLabelText('شماره موبایل');

        expect(document.documentElement.dir).toBe('rtl');
        fireEvent.click(screen.getByRole('button', { name: 'زبان: فارسی' }));
        expect(screen.getByRole('link', { name: /English/ }).getAttribute('href')).toBe('/en');
    });

    it('asks for an email and prices the card at its face value in dollars', async () => {
        render(<App url="/en" />);

        const input = await screen.findByLabelText('Email');
        expect(input.getAttribute('id')).toBe('email-10');
        expect(screen.queryByLabelText('شماره موبایل')).toBeNull();
        expect(document.body.textContent).toContain('Nura $10 gift card');
        expect(document.body.textContent).toContain('$10.00');
        // The Toman price belongs to the other shop.
        expect(document.body.textContent).not.toContain('تومان');
    });

    it('refuses to advance on an email the shared schema rejects', async () => {
        render(<App url="/en" />);
        const input = await screen.findByLabelText('Email');

        fireEvent.change(input, { target: { value: 'buyer@example' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        expect(screen.queryByText('Change email')).toBeNull();
        expect(document.body.textContent).toContain('Enter a valid email address.');
    });

    it('opens a Plisio checkout and keeps the receipt for the trip back', async () => {
        const calls: Array<Record<string, unknown>> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string, init?: RequestInit) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(CATALOG));
                }
                if (String(input).includes('/api/pay/start-en')) {
                    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
                    return Promise.resolve(
                        json({ payUrl: 'https://plisio.test/invoice/x', receipt: 'r-123' })
                    );
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/en" />);
        const input = await screen.findByLabelText('Email');
        fireEvent.change(input, { target: { value: 'buyer@example.com' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // Read back before any money moves, exactly like the mobile number.
        expect(screen.getByText('Change email')).not.toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: /^Pay \$10\.00/ }));

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).toEqual({ amount: 10, email: 'buyer@example.com', lang: 'en' });
        await vi.waitFor(() =>
            expect(sessionStorage.getItem('ashbringer-pending-receipt')).toBe('r-123')
        );
    });

    it('will not sell while Plisio has no key', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json({ ...CATALOG, englishOpen: false }));
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/en" />);
        const button = await screen.findByText('Not available');
        expect(button.closest('button')?.hasAttribute('disabled')).toBe(true);
    });

    it('picks the receipt back up on return from Plisio and waits for the chain', async () => {
        sessionStorage.setItem('ashbringer-pending-receipt', 'r-456');
        const asked: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(CATALOG));
                }
                if (String(input).includes('/api/pay/receipt')) {
                    asked.push(String(input));
                    return Promise.resolve(
                        json({
                            outcome: 'pending',
                            amount: 10,
                            toman: 0,
                            lang: 'en',
                            phone: 'buyer@example.com',
                            code: null,
                            refId: null,
                            smsDelivered: false
                        })
                    );
                }
                return Promise.resolve(json({}, 401));
            })
        );

        render(<App url="/en?pay=return" />);

        expect(await screen.findByText('Waiting for your payment to confirm')).not.toBeNull();
        expect(asked[0]).toContain('token=r-456');
        sessionStorage.clear();
    });

    it('says the code is on its way when the tab has no receipt to pick up', async () => {
        sessionStorage.clear();
        render(<App url="/en?pay=return" />);
        expect(await screen.findByText('Thanks - we are checking your payment')).not.toBeNull();
    });
});

describe('every language', () => {
    const PAGES: Array<[lang: string, path: string, locale: string, dir: string]> = [
        ['fa', '/', 'fa-IR', 'rtl'],
        ['en', '/en', 'en-US', 'ltr'],
        ['ar', '/ar', 'ar', 'rtl'],
        ['es', '/es', 'es', 'ltr'],
        ['pt', '/pt', 'pt-BR', 'ltr'],
        ['hi', '/hi', 'hi-IN', 'ltr'],
        ['zh', '/zh', 'zh-CN', 'ltr'],
        ['ru', '/ru', 'ru', 'ltr'],
        ['fr', '/fr', 'fr', 'ltr'],
        ['tr', '/tr', 'tr', 'ltr']
    ];

    for (const [lang, path, locale, dir] of PAGES) {
        it(`${lang}: sets the document, sells through the right shop, and lists every language`, async () => {
            const { container } = render(<App url={path} />);

            // Persian is the Toman shop with a mobile number; every other language the dollar
            // shop with an email.
            await vi.waitFor(() =>
                expect(
                    container.querySelector(lang === 'fa' ? '#phone-10' : '#email-10')
                ).not.toBeNull()
            );
            expect(document.documentElement.lang).toBe(locale);
            expect(document.documentElement.dir).toBe(dir);

            // The section links stay on this language's page.
            const hrefs = [...container.querySelectorAll('nav a')].map((a) =>
                a.getAttribute('href')
            );
            expect(hrefs).toContain(path === '/' ? '/#cards' : `${path}#cards`);

            // The switcher: ten links, each with its flag, the current one marked.
            const trigger = container.querySelector<HTMLButtonElement>(
                '[aria-controls="language-menu-panel"]'
            );
            expect(trigger?.querySelector('img')?.getAttribute('src')).toMatch(
                /^\/flags\/\w+\.svg$/
            );
            fireEvent.click(trigger as HTMLButtonElement);
            const links = [...container.querySelectorAll('#language-menu-panel a')];
            expect(links.map((a) => a.getAttribute('href'))).toEqual([
                '/en',
                '/',
                '/ar',
                '/es',
                '/pt',
                '/hi',
                '/zh',
                '/ru',
                '/fr',
                '/tr'
            ]);
            expect(links.every((a) => a.querySelector('img[src^="/flags/"]') !== null)).toBe(true);
            expect(
                container
                    .querySelector('#language-menu-panel [aria-current="true"]')
                    ?.getAttribute('href')
            ).toBe(path);

            // The eNamad seal is an Iranian licence: on the Persian page only.
            const seal = container.querySelector('a[href*="trustseal.enamad.ir"]');
            expect(seal === null).toBe(lang !== 'fa');
        });
    }

    it("names the shop in the page's language, else in English", async () => {
        const french = render(<App url="/fr" />);
        await vi.waitFor(() => expect(document.title).toContain('Boutique'));
        french.unmount();

        // Spanish has no name of its own: the English one stands in.
        render(<App url="/es" />);
        await vi.waitFor(() => expect(document.title).toContain('Ashbringer'));
    });

    it('sends Plisio back to the page the buyer started on', async () => {
        const calls: Array<Record<string, unknown>> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string, init?: RequestInit) => {
                if (String(input).includes('/api/pay/catalog')) {
                    return Promise.resolve(json(CATALOG));
                }
                if (String(input).includes('/api/pay/start-en')) {
                    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
                    return Promise.resolve(
                        json({ payUrl: 'https://plisio.test/invoice/x', receipt: 'r-1' })
                    );
                }
                return Promise.resolve(json({}, 401));
            })
        );

        const { container } = render(<App url="/tr" />);
        await vi.waitFor(() => expect(container.querySelector('#email-10')).not.toBeNull());
        const input = container.querySelector('#email-10') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'alici@example.com' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        const pay = [...container.querySelectorAll('button')].find(
            (button) =>
                button.textContent?.includes('10') === true &&
                !button.disabled &&
                button.type !== 'submit'
        );
        fireEvent.click(pay as HTMLButtonElement);

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).toEqual({ amount: 10, email: 'alici@example.com', lang: 'tr' });
        sessionStorage.clear();
    });
});
