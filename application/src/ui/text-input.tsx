// One text control, so every field on the site is the same height, the same radius, and
// focuses to the same colour.
//
// `latin` is the prop that matters. A phone number, a merchant id, a URL and a gift code are
// Latin runs inside Persian prose: each needs `dir="ltr"` to keep bidi from reordering the
// sentence around it, and the monospace face so a transcribed character can be checked. It
// was three attributes and a class at every call site, which is three chances to forget one.
import type { ReactNode } from 'react';

export interface TextInputProps {
    id: string;
    value: string;

    /**
     * Called with the VALUE, not the event - every call site wants the string, and the two
     * that wanted the event were reaching through `event.target` to get it anyway.
     */
    onChange?: (value: string) => void;

    type?: string;
    placeholder?: string;

    /** A Latin run: isolated direction, monospace, start-aligned. */
    latin?: boolean;

    /** `paper` for a field inside a panel, `surface` for one on the page. */
    tone?: 'paper' | 'surface';

    inputMode?: 'text' | 'tel' | 'numeric' | 'email' | 'url';
    autoComplete?: string;
    disabled?: boolean;

    /** Marks the control when the field it sits in is showing an error. */
    invalid?: boolean;

    className?: string;
}

export default function TextInput(props: TextInputProps): ReactNode {
    const shape = [
        'min-h-tap w-full rounded-xl border px-4 outline-none focus:border-firouze',
        props.invalid === true ? 'border-danger' : 'border-line',
        props.tone === 'surface' ? 'bg-surface' : 'bg-paper',
        props.latin === true ? 'latin text-start text-small' : '',
        props.className ?? ''
    ]
        .filter((part) => part !== '')
        .join(' ');

    return (
        <input
            id={props.id}
            type={props.type ?? 'text'}
            dir={props.latin === true ? 'ltr' : undefined}
            inputMode={props.inputMode}
            autoComplete={props.autoComplete}
            spellCheck={props.latin === true ? false : undefined}
            aria-invalid={props.invalid === true ? 'true' : undefined}
            className={shape}
            placeholder={props.placeholder}
            disabled={props.disabled === true}
            value={props.value}
            onChange={(event) => props.onChange?.(event.target.value)}
        />
    );
}
