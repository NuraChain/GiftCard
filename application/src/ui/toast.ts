// Transient notices, and the rule for when one is warranted.
//
// A toast is for a result the reader CANNOT see where they acted: the stock strip that
// changed while their eye was on the paste box, a refresh whose data came back identical, a
// session that expired and dropped them at the lock screen. It is the wrong tool for
// anything that must persist or be acted on - a gift code, a field error, a payment
// outcome, a list of rejected lines. Those live in the page, where they can be read twice.
//
// `createStore` is the seam rather than a module-level signal: on the client it caches one
// instance for the whole app, and under SSR every render gets its own, so a notice can
// never leak from one request into another.
import { createSignal, createStore } from 'azerothjs';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast
{
    id: number;
    tone: ToastTone;
    message: string;
}

/** How long a notice stays. Long enough to read one line, short enough not to nag. */
const LIFETIME_MS = 4500;

/** More than this on screen and they stop being read, so the oldest goes. */
const MAX_VISIBLE = 3;

export const useToasts = createStore(() =>
{
    const [toasts, setToasts] = createSignal<Toast[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 0;

    const dismiss = (id: number): void =>
    {
        const timer = timers.get(id);
        if (timer !== undefined)
        {
            clearTimeout(timer);
            timers.delete(id);
        }
        setToasts((current) => current.filter((toast) => toast.id !== id));
    };

    const push = (tone: ToastTone, message: string): void =>
    {
        nextId += 1;
        const id = nextId;
        let dropped: Toast[] = [];
        setToasts((current) =>
        {
            const next = [...current, { id, tone, message }];
            dropped = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
            return next.slice(-MAX_VISIBLE);
        });
        // The cap silently removes the oldest, so its timer is cleared here rather than left
        // to fire against a toast that is no longer on screen.
        for (const toast of dropped)
        {
            clearTimeout(timers.get(toast.id));
            timers.delete(toast.id);
        }
        timers.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
    };

    return {
        toasts,
        dismiss,

        /**
         * Stops the countdown. A reader who moves to a notice is reading it, and pulling it
         * out from under them mid-sentence is the reason toasts get a bad name.
         */
        hold: (id: number): void =>
        {
            const timer = timers.get(id);
            if (timer !== undefined)
            {
                clearTimeout(timer);
                timers.delete(id);
            }
        },

        /** Restarts the countdown once the pointer leaves. */
        release: (id: number): void =>
        {
            if (!timers.has(id) && toasts().some((toast) => toast.id === id))
            {
                timers.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
            }
        },

        success: (message: string) => push('success', message),
        error: (message: string) => push('error', message),
        info: (message: string) => push('info', message)
    };
});
