// Transient notices, and the rule for when one is warranted.
//
// A toast is for a result the reader CANNOT see where they acted: the stock strip that
// changed while their eye was on the paste box, a refresh whose data came back identical, a
// session that expired and dropped them at the lock screen. It is the wrong tool for
// anything that must persist or be acted on - a gift code, a field error, a payment
// outcome, a list of rejected lines. Those live in the page, where they can be read twice.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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

export interface ToastStore
{
    toasts: Toast[];
    dismiss(id: number): void;

    /**
     * Stops the countdown. A reader who moves to a notice is reading it, and pulling it
     * out from under them mid-sentence is the reason toasts get a bad name.
     */
    hold(id: number): void;

    /** Restarts the countdown once the pointer leaves. */
    release(id: number): void;

    success(message: string): void;
    error(message: string): void;
    info(message: string): void;
}

const ToastContext = createContext<ToastStore | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactNode
{
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    const nextId = useRef(0);

    // `release` needs to know whether a notice is still on screen, and reading `toasts` from
    // the closure would read whatever it was when the handler was created.
    //
    // Written in an EFFECT rather than during render: a ref assigned while rendering is a
    // mutation React is free to run twice or throw away, and the value a pointer handler
    // needs is the one that was actually painted - which is exactly what an effect sees.
    const live = useRef<Toast[]>([]);
    useEffect(() =>
    {
        live.current = toasts;
    }, [toasts]);

    const clearTimer = useCallback((id: number): void =>
    {
        const timer = timers.current.get(id);
        if (timer !== undefined)
        {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const dismiss = useCallback((id: number): void =>
    {
        clearTimer(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, [clearTimer]);

    const arm = useCallback((id: number): void =>
    {
        timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
    }, [dismiss]);

    const push = useCallback((tone: ToastTone, message: string): void =>
    {
        nextId.current += 1;
        const id = nextId.current;
        setToasts((current) =>
        {
            const next = [...current, { id, tone, message }];
            // The cap silently removes the oldest, so its timer is cleared here rather than
            // left to fire against a toast that is no longer on screen.
            for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE)))
            {
                clearTimer(dropped.id);
            }
            return next.slice(-MAX_VISIBLE);
        });
        arm(id);
    }, [arm, clearTimer]);

    // Every pending timer is a callback into a component that is going away.
    useEffect(() =>
    {
        const pending = timers.current;
        return () =>
        {
            for (const timer of pending.values())
            {
                clearTimeout(timer);
            }
            pending.clear();
        };
    }, []);

    const store = useMemo<ToastStore>(() => ({
        toasts,
        dismiss,
        hold: clearTimer,
        release: (id) =>
        {
            if (!timers.current.has(id) && live.current.some((toast) => toast.id === id))
            {
                arm(id);
            }
        },
        success: (message) => push('success', message),
        error: (message) => push('error', message),
        info: (message) => push('info', message)
    }), [toasts, dismiss, clearTimer, arm, push]);

    return <ToastContext value={ store }>{ children }</ToastContext>;
}

export function useToasts(): ToastStore
{
    const store = useContext(ToastContext);
    if (store === null)
    {
        throw new Error('useToasts was called outside <ToastProvider>');
    }
    return store;
}
