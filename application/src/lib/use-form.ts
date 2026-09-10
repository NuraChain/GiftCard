// A form, validated by the SAME schema the server enforces.
//
// This is deliberately small - values, what went wrong, and what the reader has touched. The
// point is not to be a form library; it is that the rule deciding whether a phone number is
// valid is imported from the contract rather than written a second time in the browser. When
// the server's idea of a valid number changes, this form's does too, with nothing to keep in
// step.
//
// ERRORS ARE ONLY SHOWN FOR TOUCHED FIELDS. Marking a field wrong before anyone has typed in
// it is scolding somebody for not having done something yet; a submit marks everything
// touched at once, which is the moment all of it becomes fair to point at.
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import type { ZodType } from 'zod';

export interface Form<T extends Record<string, unknown>>
{
    values: T;

    /** The message for a field, or '' when it is valid or not yet touched. */
    errorFor(name: keyof T & string): string;

    /** True when every field currently passes - what a submit button reads. */
    valid: boolean;

    set<K extends keyof T & string>(name: K, value: T[K]): void;

    /** Wraps a submit: validates first, and only then calls `onValid`. */
    handleSubmit(onValid: (values: T) => void): (event: FormEvent) => void;

    reset(): void;
}

export function useForm<T extends Record<string, unknown>>(schema: ZodType<T>, initial: T): Form<T>
{
    const [values, setValues] = useState<T>(initial);
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    // Derived rather than stored: an error map kept in state is a second source of truth
    // that drifts one render behind whatever the reader just typed.
    const errors = useMemo(() =>
    {
        const result = schema.safeParse(values);
        if (result.success)
        {
            return {} as Record<string, string>;
        }
        const found: Record<string, string> = {};
        for (const issue of result.error.issues)
        {
            const key = issue.path.map(String).join('.');
            found[key === '' ? '_' : key] = issue.message;
        }
        return found;
    }, [schema, values]);

    const set = useCallback(<K extends keyof T & string>(name: K, value: T[K]): void =>
    {
        setValues((current) => ({ ...current, [name]: value }));
        setTouched((current) => ({ ...current, [name]: true }));
    }, []);

    const handleSubmit = useCallback((onValid: (values: T) => void) =>
        (event: FormEvent): void =>
        {
            event.preventDefault();
            const result = schema.safeParse(values);
            if (!result.success)
            {
                // Everything is fair to point at now, including fields never visited.
                const all: Record<string, boolean> = {};
                for (const key of Object.keys(values))
                {
                    all[key] = true;
                }
                setTouched(all);
                return;
            }
            onValid(result.data);
        }, [schema, values]);

    const reset = useCallback((): void =>
    {
        setValues(initial);
        setTouched({});
        // `initial` is a literal at every call site, so it is stable in practice; listing it
        // would re-create `reset` on every render of a component that inlines the object.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        values,
        valid: Object.keys(errors).length === 0,
        errorFor: (name) => (touched[name] === true ? errors[name] ?? '' : ''),
        set,
        handleSubmit,
        reset
    };
}
