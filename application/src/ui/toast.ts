// Transient notices, and the rule for when one is warranted.
//
// A toast is for a result the reader CANNOT see where they acted: the stock strip that
// changed while their eye was on the paste box, a refresh whose data came back identical, a
// session that expired and dropped them at the lock screen. It is the wrong tool for
// anything that must persist or be acted on - a gift code, a field error, a payment
// outcome, a list of rejected lines. Those live in the page, where they can be read twice.
import { createContext, createSignal, onCleanup, provideContext, useContext } from 'azerothjs';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
    id: number;
    tone: ToastTone;
    message: string;
}

/** How long a notice stays. Long enough to read one line, short enough not to nag. */
const LIFETIME_MS = 4500;

/** More than this on screen and they stop being read, so the oldest goes. */
const MAX_VISIBLE = 3;

export interface ToastStore {
    /** What is on screen now. A getter: the host's list follows it. */
    readonly toasts: Toast[];

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

const ToastContext = createContext<ToastStore>(undefined, 'Toasts');

/** Builds the store and provides it below the caller. The shell calls it once, at setup. */
export function provideToasts(): ToastStore {
    const [toasts, setToasts] = createSignal<Toast[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 0;

    function clearTimer(id: number): void {
        const timer = timers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(id);
        }
    }

    function dismiss(id: number): void {
        clearTimer(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }

    function arm(id: number): void {
        timers.set(
            id,
            setTimeout(() => dismiss(id), LIFETIME_MS)
        );
    }

    function push(tone: ToastTone, message: string): void {
        nextId += 1;
        const id = nextId;
        const next = [...toasts(), { id, tone, message }];
        // The cap silently removes the oldest, so its timer is cleared here rather than left
        // to fire against a toast that is no longer on screen.
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
            clearTimer(dropped.id);
        }
        setToasts(() => next.slice(-MAX_VISIBLE));
        arm(id);
    }

    // Every pending timer is a callback into a tree that is going away.
    onCleanup(() => {
        for (const timer of timers.values()) {
            clearTimeout(timer);
        }
        timers.clear();
    });

    const store: ToastStore = {
        get toasts() {
            return toasts();
        },
        dismiss,
        hold: clearTimer,
        release: (id) => {
            if (!timers.has(id) && toasts().some((toast) => toast.id === id)) {
                arm(id);
            }
        },
        success: (message) => push('success', message),
        error: (message) => push('error', message),
        info: (message) => push('info', message)
    };
    provideContext(ToastContext, store);
    return store;
}

export function useToasts(): ToastStore {
    const store = useContext(ToastContext);
    if (store === undefined) {
        throw new Error('useToasts was called outside the shell that provides the toasts');
    }
    return store;
}
