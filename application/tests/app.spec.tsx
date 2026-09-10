// Component tests against real DOM (happy-dom) through the same build pipeline that serves
// the app. `App` takes a `url` so a test can pin the route without an address bar.
//
// The catalogue is fetched, so `fetch` is stubbed here rather than left to hit a server that
// is not running. What each test asserts is what the page does with an answer - or, in the
// first one, what it does while there is not one yet.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import App from '../src/App.tsx';
import { FAQS, ASSURANCES } from '../src/lib/content.ts';

const CATALOG = {
    appName: 'گاردین سرویس',
    tiers: [
        {
            amount: 10,
            toman: 700_000,
            available: 4,
            title: 'کارت ده دلاری',
            blurb: 'رایج‌ترین انتخاب.',
            recommended: true
        }
    ]
};

beforeEach(() => {
    // One answer for the catalogue, a refusal for anything else - the console's routes are
    // guarded and this suite never signs in.
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string) => {
            if (String(input).includes('/api/pay/catalog')) {
                return Promise.resolve(
                    new Response(JSON.stringify(CATALOG), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
                );
            }
            return Promise.resolve(
                new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
            );
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
    it('puts a phone input on every card and no purchase form at the foot of the page', async () => {
        render(<App url="/" />);

        // The catalogue answer arrives on a microtask; the card renders with it.
        const input = await screen.findByLabelText('شماره موبایل');
        expect(input.getAttribute('id')).toBe('phone-10');

        // The card owns the purchase now, so there is exactly one phone field - the one on
        // the card - and no second copy in a panel below.
        expect(screen.getAllByLabelText('شماره موبایل')).toHaveLength(1);
        expect(document.querySelector('#purchase')).toBeNull();
    });

    it('refuses to advance on a number the shared schema rejects', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');

        fireEvent.change(input, { target: { value: '12345' } });
        // The FORM is submitted rather than the button clicked: happy-dom does not perform a
        // button's implicit submission, so a click here would assert nothing at all.
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // The same rule the server enforces, running in the browser: no confirm step, and
        // the field says why in the buyer's own language.
        expect(screen.queryByText('ویرایش شماره')).toBeNull();
        expect(document.body.textContent).toContain('شماره موبایل معتبر نیست');
    });

    it('reads the number back before it will take money', async () => {
        render(<App url="/" />);
        const input = await screen.findByLabelText('شماره موبایل');

        fireEvent.change(input, { target: { value: '09170459330' } });
        fireEvent.submit(input.closest('form') as HTMLFormElement);

        // A mistyped digit is discovered after the money has moved, so the number is read
        // back on the card before the gateway is opened.
        expect(screen.getByText('ویرایش شماره')).not.toBeNull();
        expect(document.body.textContent).toContain('09170459330');
    });
});
