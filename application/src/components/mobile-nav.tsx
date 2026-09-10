// The phone navigation: a DISCLOSURE panel, deliberately not a modal drawer.
//
// The nav is three in-page anchors. A modal drawer would oblige a focus trap, a scroll lock,
// role="dialog"/aria-modal, and focus restoration - and a drawer that skips any of those is
// worse than no drawer, because it can strand a keyboard user inside it. A non-modal
// disclosure needs none of that machinery and cannot trap anyone. If this nav ever grows past
// ~5 items, promote it to a real modal and take on the full contract at that point.
//
// The theme control deliberately does NOT live in here: it sits beside the trigger in the
// header, so changing theme is one tap from anywhere instead of two. This panel holds
// navigation, which is the one thing it is for.
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MobileNavProps
{
    links: Array<{ href: string; label: string }>;
}

export default function MobileNav({ links }: MobileNavProps): ReactNode
{
    const [open, setOpen] = useState(false);

    // The trigger, so Escape can hand focus back to it. Losing focus to <body> on close is
    // the classic disclosure bug: the next Tab restarts from the top of the document instead
    // of continuing from the control you just used.
    const trigger = useRef<HTMLButtonElement | null>(null);
    const panel = useRef<HTMLDivElement | null>(null);

    useEffect(() =>
    {
        if (!open)
        {
            return;
        }

        const onKey = (event: KeyboardEvent): void =>
        {
            if (event.key === 'Escape')
            {
                setOpen(false);
                trigger.current?.focus();
            }
        };

        // Armed one task late: the pointerdown that OPENED the panel is still propagating,
        // and a listener attached synchronously would see it and close the panel immediately.
        let onOutside: ((event: Event) => void) | undefined;
        const arm = setTimeout(() =>
        {
            onOutside = (event: Event): void =>
            {
                const target = event.target as Node | null;
                if (target !== null
                    && !(panel.current?.contains(target) ?? false)
                    && !(trigger.current?.contains(target) ?? false))
                {
                    setOpen(false);
                }
            };
            document.addEventListener('pointerdown', onOutside);
        }, 0);

        document.addEventListener('keydown', onKey);

        return () =>
        {
            clearTimeout(arm);
            document.removeEventListener('keydown', onKey);
            if (onOutside !== undefined)
            {
                document.removeEventListener('pointerdown', onOutside);
            }
        };
    }, [open]);

    return (
        <div className="md:hidden">
            <button
                type="button"
                ref={ trigger }
                className="flex size-tap items-center justify-center rounded-xl border border-line text-ink"
                aria-expanded={ open ? 'true' : 'false' }
                aria-controls="mobile-nav-panel"
                aria-label={ open ? 'بستن منو' : 'باز کردن منو' }
                onClick={ () => setOpen((current) => !current) }
            >
                { open ? <X className="size-5" aria-hidden="true"/> : <Menu className="size-5" aria-hidden="true"/> }
            </button>

            { open && (
                <div
                    id="mobile-nav-panel"
                    ref={ panel }
                    className="anim-settle absolute inset-x-0 top-full border-b border-line bg-paper p-3 shadow-lg"
                >
                    <ul className="flex flex-col">
                        { links.map((link) => (
                            <li key={ link.href }>
                                <a
                                    className="flex min-h-tap items-center rounded-xl px-3 text-small transition-colors hover:bg-surface hover:text-firouze"
                                    href={ link.href }
                                    onClick={ () => setOpen(false) }
                                >
                                    { link.label }
                                </a>
                            </li>
                        )) }
                    </ul>
                </div>
            ) }
        </div>
    );
}
