// The page's signature motif. What a buyer actually receives is a string of characters that
// either works or does not, so the code IS the product and gets to be the hero rather than a
// stock card illustration. The `verified` variant is the only place the gold token is spent,
// which keeps its appearance meaningful.
//
// Two places use this: the hero, where the code is a clearly labelled sample, and the
// receipt, where it is the real thing the buyer just paid for. It is no longer on the cards -
// each card carries the phone input instead, because the thing a buyer does on a card is
// start a purchase.
//
// The code carries dir="ltr": it isolates the Latin run so it cannot scramble the Persian
// layout around it, and keeps its own characters in reading order.
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export interface CodeCapsuleProps
{
    code: string;
    label: string;
    verified?: boolean;
    scanning?: boolean;
}

export default function CodeCapsule(props: CodeCapsuleProps): ReactNode
{
    return (
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-muted">{ props.label }</span>
                { props.verified === true && (
                    <span className="flex items-center gap-1.5 text-caption font-bold text-gold">
                        <Check className="size-4" aria-hidden="true"/>
                        تأیید شد
                    </span>
                ) }
            </div>

            {/* `break-all` and a modest size are not styling preferences: a UUID is 36
                characters and the capsule can sit in a narrow column, so anything larger
                overflows a container that has to clip for the scan sweep - and a clipped code
                is a code the buyer cannot read or copy. It wraps instead. */}
            <p className="mt-2 text-start text-base font-semibold break-all sm:text-lg">
                <span dir="ltr" className="latin inline-block">{ props.code }</span>
            </p>

            { props.scanning === true && (
                <span
                    className="anim-scan pointer-events-none absolute top-0 h-full w-1/4 bg-linear-to-r from-transparent via-firouze/25 to-transparent"
                    aria-hidden="true"
                ></span>
            ) }
        </div>
    );
}
