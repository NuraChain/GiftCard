// One compact control that cycles light -> dark -> system.
//
// It replaced a three-segment labelled pill. The pill was the heaviest object in the header
// and read as a settings panel dropped into a landing page; a single button carrying the
// CURRENT mode's glyph says the same thing in a quarter of the space and matches the menu
// trigger's shape exactly, so on a phone the header reads as two identical affordances
// rather than a pill plus a button.
//
// The cost of cycling is that the control cannot show what comes next, so the accessible
// name and the tooltip both name the NEXT mode - which is what a screen reader announces and
// the only thing a sighted user needs from a tooltip.
//
// The choice is written to localStorage under the same key the inline <head> script reads, so
// a reload never flashes the wrong theme.
//
// The stored value is read in an EFFECT rather than during render: `localStorage` is a side
// effect, and reading it while rendering makes the first paint depend on something React is
// free to re-run.
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

type Choice = 'system' | 'light' | 'dark';

interface Mode {
    value: Choice;
    glyph: LucideIcon;

    /** Persian name, used to say what clicking will switch TO. */
    label: string;
}

// Cycle order is deliberate: the two explicit modes first, then back to following the
// system. A user who only wants "make it dark" gets there in one tap.
const MODES: Mode[] = [
    { value: 'light', glyph: Sun, label: 'روشن' },
    { value: 'dark', glyph: Moon, label: 'تاریک' },
    { value: 'system', glyph: Monitor, label: 'پیروی از سیستم' }
];

export default function ThemeToggle(): ReactNode {
    const [choice, setChoice] = useState<Choice>('system');

    useEffect(() => {
        try {
            const stored = localStorage.getItem('ashbringer-theme');
            setChoice(stored === 'light' || stored === 'dark' ? stored : 'system');
        } catch {
            setChoice('system');
        }
    }, []);

    const index = MODES.findIndex((mode) => mode.value === choice);
    const settled = index === -1 ? 2 : index;
    const current = MODES[settled];
    const next = MODES[(settled + 1) % MODES.length];

    const apply = (value: Choice): void => {
        setChoice(value);
        const root = document.documentElement;
        try {
            if (value === 'system') {
                root.removeAttribute('data-theme');
                localStorage.removeItem('ashbringer-theme');
                return;
            }
            root.setAttribute('data-theme', value);
            localStorage.setItem('ashbringer-theme', value);
        } catch {
            // Storage unavailable: the attribute still applies for this session.
        }
    };

    const Glyph = current.glyph;

    return (
        <button
            type="button"
            className="flex size-tap items-center justify-center rounded-xl border border-line text-muted transition-colors hover:border-firouze hover:text-firouze"
            aria-label={`تغییر پوسته به ${next.label}`}
            title={`تغییر پوسته به ${next.label}`}
            onClick={() => apply(next.value)}
        >
            {/* Keyed on the mode so React mounts a FRESH glyph on every change, which is what
                lets the swap animation play once per press with no state to track. */}
            <Glyph key={current.value} className="size-5 animate-icon-swap" aria-hidden="true" />
        </button>
    );
}
