// One accordion row. A real <button> with aria-expanded/aria-controls rather than a
// clickable div, so it is reachable and operable from the keyboard and announced correctly.
// The panel stays in the DOM when closed (hidden), which keeps the answers readable to
// find-in-page and to anything reading the markup rather than the screen.
//
// The chevron ROTATES to point at the open panel rather than mirroring: a vertical indicator
// reads identically in RTL and LTR, so it needs no direction handling.
//
// aria-expanded takes the STRINGS "true"/"false", not a boolean: a boolean renders as a bare
// attribute, which is invalid ARIA and leaves the state unannounced.
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export interface FaqItemProps
{
    id: string;
    question: string;
    answer: string;
    open: boolean;
    onToggle: (id: string) => void;
}

export default function FaqItem(props: FaqItemProps): ReactNode
{
    return (
        <div className="border-b border-line last:border-b-0">
            <h3>
                <button
                    type="button"
                    id={ `faq-button-${ props.id }` }
                    className="flex min-h-tap w-full items-center justify-between gap-4 py-4 text-start text-h3 font-bold hover:text-firouze"
                    aria-expanded={ props.open ? 'true' : 'false' }
                    aria-controls={ `faq-panel-${ props.id }` }
                    onClick={ () => props.onToggle(props.id) }
                >
                    { props.question }
                    <ChevronDown
                        className={ `size-4 shrink-0 text-muted transition-transform ${ props.open ? 'rotate-180' : '' }` }
                        aria-hidden="true"
                    />
                </button>
            </h3>
            <div
                id={ `faq-panel-${ props.id }` }
                role="region"
                aria-labelledby={ `faq-button-${ props.id }` }
                hidden={ !props.open }
                className="pb-4 text-small text-muted"
            >
                { props.answer }
            </div>
        </div>
    );
}
