// Component tests run against real DOM (happy-dom) through the compiler - the same
// pipeline that serves the app. App takes a `url` so tests pin the route.
import { describe, it, expect, afterEach } from 'vitest';
import { renderTest, cleanup, fire } from '@azerothjs/testing';

import App from '../src/App.azeroth';
import { FAQS, ASSURANCES } from '../src/content.ts';

afterEach(cleanup);

describe('landing page', () =>
{
    it('the card section always says something, catalogue or no catalogue', () =>
    {
        // The denominations are no longer a constant a test could assert against - the
        // catalogue is editable and fetched at runtime. What must still hold is that the
        // section is never BLANK: skeleton, error, "nothing for sale", or the cards
        // themselves. A silent empty region reads as a broken shop.
        const { container } = renderTest(() => App({ url: '/' }));
        const cards = container.querySelector('#cards');

        expect(cards).not.toBeNull();
        expect(cards?.textContent).toContain('کارت خود را انتخاب کنید');
        const region = cards?.querySelector('.mt-stack');
        expect((region?.textContent ?? '') + (region?.innerHTML ?? '')).not.toBe('');
    });

    it('shows every FAQ answer in the markup, so a prerendered page reads without JS', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        for (const faq of FAQS)
        {
            expect(container.textContent, faq.id).toContain(faq.question);
            expect(container.textContent, faq.id).toContain(faq.answer);
        }
    });

    it('the FAQ accordion toggles aria-expanded and the panel', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        const first = FAQS[0].id;
        const button = container.querySelector<HTMLButtonElement>(`#faq-button-${ first }`);
        const panel = container.querySelector<HTMLElement>(`#faq-panel-${ first }`);

        // The first row starts open, so the section never renders as a wall of closed rows.
        expect(button?.getAttribute('aria-expanded')).toBe('true');
        expect(panel?.hasAttribute('hidden')).toBe(false);

        if (button)
        {
            fire(button, 'click');
        }
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        expect(panel?.hasAttribute('hidden')).toBe(true);
    });

    it('isolates every Latin run so it cannot scramble the Persian layout', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        // Prices, sample codes, and the email are Latin inside RTL prose: each must
        // carry its own direction or bidi reorders the surrounding sentence.
        for (const node of container.querySelectorAll('.latin'))
        {
            expect(node.getAttribute('dir'), node.textContent ?? '').toBe('ltr');
        }
    });

    it('the mobile nav trigger exposes string aria-expanded and toggles its panel', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        const trigger = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-nav-panel"]');

        // The string form matters: a boolean compiles to a bare attribute that
        // announces nothing.
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');
        // <Transition> mounts and unmounts the panel rather than toggling `hidden`,
        // so a closed panel is absent from the DOM entirely.
        expect(container.querySelector('#mobile-nav-panel')).toBeNull();

        if (trigger)
        {
            fire(trigger, 'click');
        }
        expect(trigger?.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('#mobile-nav-panel')).not.toBeNull();
    });

    it('the theme control cycles light -> dark -> system and names the NEXT mode', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        const button = container.querySelector<HTMLButtonElement>('[title^="تغییر پوسته"]');

        // Default is system, so the first click offers light.
        expect(button?.getAttribute('aria-label')).toContain('روشن');
        if (button)
        {
            fire(button, 'click');
            expect(button.getAttribute('aria-label')).toContain('تاریک');
            fire(button, 'click');
            expect(button.getAttribute('aria-label')).toContain('پیروی از سیستم');
            fire(button, 'click');
            expect(button.getAttribute('aria-label')).toContain('روشن');
        }
    });

    it('every hero assurance carries a glyph', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        for (const item of ASSURANCES)
        {
            expect(container.textContent, item.label).toContain(item.label);
            expect(container.textContent, item.detail).toContain(item.detail);
        }
        // Lucide renders real <svg>; the icons are decorative and must stay hidden.
        const decorative = [...container.querySelectorAll('svg')];
        expect(decorative.length).toBeGreaterThan(0);
        for (const svg of decorative)
        {
            expect(svg.getAttribute('aria-hidden')).toBe('true');
        }
    });

    it('never applies tracking to Persian text (it would break letter joining)', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        const tracked = [...container.querySelectorAll('[class*="tracking-"]')]
            .filter((node) => !node.classList.contains('latin'));
        expect(tracked.map((node) => node.className)).toEqual([]);
    });
});
