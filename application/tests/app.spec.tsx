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
import { FAQS, ASSURANCES } from '../src/lib/content.ts';

/** 10 x 100,000 + 6% = 1,060,000 - the same sum the server does, written out for the reader. */
const TEN_DOLLAR_TOMAN = 1_060_000;

function catalogBody(overrides: { toman?: number | null } = {}): Record<string, unknown> {
    return {
        appName: 'گاردین سرویس',
        tiers: [
            {
                amount: 10,
                toman: 'toman' in overrides ? overrides.toman : TEN_DOLLAR_TOMAN,
                available: 4,
                title: 'کارت ده دلاری',
                blurb: 'رایج‌ترین انتخاب.',
                recommended: true
            }
        ]
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
        for (const faq of FAQS) {
            expect(container.textContent, faq.id).toContain(faq.question);
            expect(container.textContent, faq.id).toContain(faq.answer);
        }
    });

    it('the FAQ accordion toggles aria-expanded and the panel', () => {
        const { container } = render(<App url="/" />);
        const first = FAQS[0].id;
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
        // Prices, sample codes, and the email are Latin inside RTL prose: each must carry its
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
        for (const item of ASSURANCES) {
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
});

describe('buying from a card', () => {
    it('puts an email input on every card and no purchase form at the foot of the page', async () => {
        render(<App url="/" />);

        // The catalogue answer arrives on a microtask; the card renders with it.
        const input = await screen.findByLabelText('ایمیل');
        expect(input.getAttribute('id')).toBe('email-10');

        // The card owns the purchase now, so there is exactly one email field - the one on
        // the card - and no second copy in a panel below.
        expect(screen.getAllByLabelText('ایمیل')).toHaveLength(1);
        expect(document.querySelector('#purchase')).toBeNull();
    });

    it('refuses to advance on an address the shared schema rejects', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('ایمیل');

        fireEvent.change(input, { target: { value: 'not-an-address' } });
        // The FORM is submitted rather than the button clicked: happy-dom does not perform a
        // button's implicit submission, so a click here would assert nothing at all.
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // The same rule the server enforces, running in the browser: no confirm step, and
        // the field says why in the buyer's own language.
        expect(screen.queryByText('ویرایش ایمیل')).toBeNull();
        expect(document.body.textContent).toContain('ایمیل معتبر نیست');
    });

    it('reads the address back before it will take money', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('ایمیل');

        fireEvent.change(input, { target: { value: 'buyer@example.com' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // A transposed letter in a domain is discovered after the money has moved and looks
        // perfectly fine until then, so the address is read back before the gateway opens.
        expect(screen.getByText('ویرایش ایمیل')).not.toBeNull();
        expect(document.body.textContent).toContain('buyer@example.com');
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
        const input = await screen.findByLabelText('ایمیل');
        fireEvent.change(input, { target: { value: 'buyer@example.com' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);
        // Anchored, and scoped to a BUTTON: the confirm step also carries
        // «مبلغ قابل پرداخت» and a line about the gateway, so a loose text match finds three.
        fireEvent.click(await screen.findByRole('button', { name: /^پرداخت/ }));

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        // The figure on the card travels WITH the purchase. It is not the amount - the server
        // charges its own - it is the assertion the server checks it against.
        expect(calls[0].quotedToman).toBe(TEN_DOLLAR_TOMAN);
        expect(calls[0].amount).toBe(10);
        expect(calls[0].email).toBe('buyer@example.com');
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
        const input = await screen.findByLabelText('ایمیل');
        fireEvent.change(input, { target: { value: 'buyer@example.com' } });
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
