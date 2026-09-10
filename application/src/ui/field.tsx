// A label, a control, and the line underneath that explains it.
//
// The `htmlFor`/`id` pair is the whole point: a label that is not bound to its control is a
// caption, and tapping it does nothing - which on a phone is the difference between a 44px
// target and a 16px one. Passing the id through here makes the binding impossible to forget.
import type { ReactNode } from 'react';

export interface FieldProps
{
    children: ReactNode;
    label: string;

    /** Must match the `id` of the control inside. */
    htmlFor: string;

    /** Sits under the control, quiet. */
    hint?: string;

    /** Replaces the hint and turns red. A field explains itself or it complains. */
    error?: string;

    className?: string;
}

export default function Field(props: FieldProps): ReactNode
{
    const error = props.error ?? '';
    const hint = props.hint ?? '';

    return (
        <div className={ props.className ?? '' }>
            <label className="block text-small font-bold" htmlFor={ props.htmlFor }>{ props.label }</label>
            <div className="mt-2">
                { props.children }
            </div>
            { error !== '' && <p className="mt-1 text-caption font-bold text-danger">{ error }</p> }
            { error === '' && hint !== '' && <p className="mt-1 text-caption text-muted">{ hint }</p> }
        </div>
    );
}
