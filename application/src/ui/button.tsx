// Every button on the site.
//
// It exists because the same six class strings were being retyped at thirty call sites, and
// they had already drifted: some disabled states faded to 40%, some to 60%, and one row of
// buttons was a different height from the row above it. A variant is a NAME for a decision
// that was made once.
//
// The busy state is here rather than at the call sites because it is always the same three
// things - swap the label, disable the control, and keep its width - and forgetting the
// second one is how a payment gets submitted twice.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** What the button MEANS, not what it looks like - the look is this table's business. */
const VARIANTS =
{
    /** The one action the screen is for. At most one per view. */
    primary: 'bg-firouze text-paper hover:opacity-90',
    /** Everything else that acts. */
    outline: 'border border-line hover:border-firouze hover:text-firouze',
    /** Bordered, but it turns red under the pointer: sign out, remove. */
    retreat: 'border border-line hover:border-danger hover:text-danger',
    /** Reads as dangerous before it is pressed: rotating the key. */
    danger: 'border border-danger text-danger hover:bg-danger/10',
    /** No chrome at all - a control that should not compete, like "clear". */
    ghost: 'text-muted hover:text-ink'
};

const SIZES =
{
    md: 'px-5 text-small',
    sm: 'px-4 text-caption'
};

export interface ButtonProps
{
    children: ReactNode;
    variant?: keyof typeof VARIANTS;
    size?: keyof typeof SIZES;
    type?: 'button' | 'submit';

    /** Drawn before the label. Decorative: the label is the accessible name. */
    glyph?: LucideIcon;

    /** Drawn after it, for an action that LEAVES - "continue", "pay at the gateway". */
    trailing?: LucideIcon;

    /** Below `sm` the label goes `sr-only` and this becomes a square icon button. */
    compact?: boolean;

    /** Fills its container - the bottom of a form, or a card on a phone. */
    full?: boolean;

    /** Shares a row equally with its siblings on a phone, natural width above. */
    grow?: boolean;

    /** In flight: disabled, and showing `busyText` if there is one. */
    busy?: boolean;
    busyText?: string;
    disabled?: boolean;

    /** Optional: a `submit` button is driven by its form, not by a handler. */
    onClick?: () => void;
    className?: string;
}

export default function Button(props: ButtonProps): ReactNode
{
    const { glyph: Glyph, trailing: Trailing } = props;

    const shape = [
        'flex min-h-tap items-center gap-2 rounded-xl font-bold transition-colors disabled:opacity-60',
        VARIANTS[props.variant ?? 'outline'],
        SIZES[props.size ?? 'md'],
        props.full === true ? 'w-full justify-center' : '',
        props.grow === true ? 'flex-1 justify-center sm:flex-none' : '',
        props.compact === true ? 'action-compact' : '',
        props.className ?? ''
    ].filter((part) => part !== '').join(' ');

    const busy = props.busy === true && props.busyText !== undefined;

    return (
        <button
            type={ props.type ?? 'button' }
            className={ shape }
            disabled={ props.disabled === true || props.busy === true }
            onClick={ props.onClick }
        >
            { Glyph !== undefined && <Glyph className="size-4 shrink-0" aria-hidden="true"/> }
            { busy
                ? <span>{ props.busyText }</span>
                : <span className={ props.compact === true ? 'max-sm:sr-only' : '' }>{ props.children }</span> }
            {/* `rotate-180` because the page is RTL: forward points the other way. */}
            { Trailing !== undefined && <Trailing className="size-4 shrink-0 rotate-180" aria-hidden="true"/> }
        </button>
    );
}
