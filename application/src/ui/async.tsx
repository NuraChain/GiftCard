// The four states every fetch has, in one place.
//
// A request is not "data or nothing". It is loading, or it failed, or it succeeded and found
// nothing, or it succeeded with content - and a page that only draws the last one lies about
// the other three. Before this, a failed catalogue left the shop silently unbuyable and a
// ledger search showed the previous results while the new ones were still in flight.
//
// This is deliberately NOT a toast. A failed fetch needs a retry button and has to stay on
// screen until someone acts on it; a self-dismissing pill is the wrong container for
// something that must be acted upon.
import { RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export interface AsyncProps {
    /** True while a request is in flight. */
    loading: boolean;

    /** A human-readable failure, or empty when there is none. */
    error: string;

    /** True when the request succeeded and there is genuinely nothing to show. */
    empty?: boolean;

    /** What to say when `empty`. */
    emptyText?: string;

    /** Runs when the reader asks to try again. */
    onRetry: () => void;

    /**
     * The skeleton shown while loading. Given as a node rather than a flag so a table can
     * show rows and a card grid can show cards - a spinner in the middle of a page tells the
     * reader less than a shape that says what is coming.
     */
    skeleton?: ReactNode;

    children: ReactNode;
}

export default function Async(props: AsyncProps): ReactNode {
    // Failure first: a stale success underneath must never be what the reader sees while an
    // error is true.
    if (props.error !== '') {
        return (
            <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5">
                <p className="flex items-start gap-2 text-small text-danger">
                    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
                    <span>{props.error}</span>
                </p>
                <button
                    type="button"
                    className="mt-4 flex min-h-tap items-center gap-2 rounded-xl border border-line px-4 text-small font-bold hover:border-firouze hover:text-firouze"
                    onClick={props.onRetry}
                >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    تلاش دوباره
                </button>
            </div>
        );
    }

    if (props.loading) {
        return (
            <div aria-busy="true" aria-live="polite">
                <span className="sr-only">در حال بارگذاری...</span>
                {props.skeleton ?? (
                    <div className="anim-pulse h-24 rounded-2xl border border-line bg-surface"></div>
                )}
            </div>
        );
    }

    if (props.empty === true) {
        return (
            <p className="rounded-2xl border border-line bg-surface p-5 text-small text-muted">
                {props.emptyText ?? 'چیزی برای نمایش نیست.'}
            </p>
        );
    }

    return props.children;
}
