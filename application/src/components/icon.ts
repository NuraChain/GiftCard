import { h } from 'azerothjs';
import type { IconNode } from 'lucide';

/**
 * Builds a Lucide icon as an element the framework owns.
 *
 * NOT lucide's own `createElement`: that helper calls `document.createElementNS`
 * directly, so it throws "document is not defined" the moment this page is
 * prerendered or server-rendered. A Lucide icon is really just DATA - a nested
 * `[tag, attrs, children]` tree - so building it through `h()` instead keeps one
 * code path for the server, the browser, and hydration. `h()` already routes SVG
 * tag names through createElementNS on the client, so the geometry renders.
 *
 * (The sibling AzerothJS apps use lucide's helper directly and are fine: both are
 * client-only Tauri apps that never server-render.)
 *
 * Colour is never set here - Lucide ships `stroke="currentColor"`, so an icon
 * inherits from its parent or takes a Tailwind text utility via `className`, and
 * the light/dark switch happens once at the token layer.
 *
 * Icons on this page are decorative: each sits beside a text label or inside a
 * control that has its own accessible name, so they are hidden from screen readers
 * rather than announced as a second, redundant label.
 */

/** Lucide's own defaults, inlined so the icon renders without importing its DOM helper. */
const SVG_ATTRS =
{
    xmlns: 'http://www.w3.org/2000/svg',
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
};

/** One `[tag, attrs, children?]` node of the icon tree. */
type IconChild = [string, Record<string, string | number>, IconChild[]?];

function build(node: IconChild): HTMLElement
{
    const [tag, attrs, children] = node;
    return h(tag, attrs, ...(children ?? []).map(build));
}

export const icon = (node: IconNode, className = 'size-5'): HTMLElement =>
    h(
        'svg',
        { ...SVG_ATTRS, class: className, 'aria-hidden': 'true' },
        ...(node as unknown as IconChild[]).map(build)
    );
