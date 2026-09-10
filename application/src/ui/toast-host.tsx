// Where notices appear. Mounted once, in the shell.
//
// The region is a live region, not a decoration: a sighted reader sees the pill, a screen
// reader hears it without the focus moving. `polite` for the ordinary case; an error is
// `assertive` because it usually means the thing the reader just did did not happen.
//
// Position is LOGICAL (bottom + start), so it settles into the bottom-right corner of an RTL
// page and the bottom-left of an LTR one without a direction branch.
import { Check, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useToasts, type ToastTone } from './toast.tsx';

const TONE: Record<ToastTone, { Glyph: LucideIcon; accent: string }> =
{
    success: { Glyph: Check, accent: 'text-firouze' },
    error: { Glyph: TriangleAlert, accent: 'text-danger' },
    info: { Glyph: Info, accent: 'text-muted' }
};

export default function ToastHost(): ReactNode
{
    const { toasts, dismiss, hold, release } = useToasts();

    return (
        <div
            className="pointer-events-none fixed bottom-4 start-4 z-50 flex flex-col gap-2"
            role="region"
            aria-label="اعلان‌ها"
        >
            { toasts.map((toast) =>
            {
                const { Glyph, accent } = TONE[toast.tone];
                return (
                    <div
                        key={ toast.id }
                        className="anim-toast pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-3 ps-4 shadow-lg"
                        role={ toast.tone === 'error' ? 'alert' : 'status' }
                        aria-live={ toast.tone === 'error' ? 'assertive' : 'polite' }
                        onMouseEnter={ () => hold(toast.id) }
                        onMouseLeave={ () => release(toast.id) }
                        onFocus={ () => hold(toast.id) }
                        onBlur={ () => release(toast.id) }
                    >
                        <span className={ `mt-0.5 shrink-0 ${ accent }` }>
                            <Glyph className="size-4" aria-hidden="true"/>
                        </span>
                        <p className="text-small">{ toast.message }</p>
                        <button
                            type="button"
                            className="ms-auto shrink-0 rounded-lg p-1 text-muted hover:text-ink"
                            aria-label="بستن اعلان"
                            onClick={ () => dismiss(toast.id) }
                        >
                            <X className="size-4" aria-hidden="true"/>
                        </button>
                    </div>
                );
            }) }
        </div>
    );
}
