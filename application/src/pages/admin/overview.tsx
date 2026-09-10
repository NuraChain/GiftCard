// The first question of the day: can I trade?
//
// The available count per denomination is the largest type on the page because it is the
// number that decides that. Everything else here is context for it.
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { client, failureText } from '../../lib/api.ts';
import type { AdminOverview } from '../../../../server/src/contract/index.ts';
import { count } from '../../lib/format.ts';
import { useToasts } from '../../ui/toast.tsx';
import Async from '../../ui/async.tsx';
import Button from '../../ui/button.tsx';
import AdminShell from './shell.tsx';
import { useAdminSession } from './session.tsx';

export default function Overview(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [data, setData] = useState<AdminOverview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async (announce = false): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            setData(await client.admin.overview());
            if (announce) {
                // Refreshing usually changes nothing on screen, so without a notice the
                // click looks like it did nothing at all.
                notify.success('اطلاعات به‌روز شد');
            }
        } catch (failure) {
            setError(failureText(failure, 'اطلاعات خوانده نشد'));
        } finally {
            setLoading(false);
        }
        // `notify` is rebuilt whenever a toast appears; depending on it would re-create
        // `load` mid-flight and re-run the effect below for no reason.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keyed on the session rather than on mount: this component is mounted by the ROUTE,
    // which happens before anyone has signed in, so a mount-time fetch 401s against the lock
    // screen and never retries. Watching the session means the tab fills itself the moment
    // sign-in succeeds - and again after a re-authentication.
    useEffect(() => {
        if (session.unlocked) {
            void load();
        }
    }, [session.revision, session.unlocked, load]);

    return (
        <AdminShell>
            <div className="flex items-center gap-3">
                <h2 className="text-h3 font-bold">موجودی کدها</h2>
                <Button
                    glyph={RefreshCw}
                    compact
                    className="ms-auto"
                    disabled={loading}
                    onClick={() => void load(true)}
                >
                    تازه‌سازی
                </Button>
            </div>

            {(data?.owed ?? 0) > 0 && (
                <p className="mt-5 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-4 text-small font-bold text-danger">
                    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
                    {count(data?.owed ?? 0)} سفارش پرداخت‌شده بدون کد مانده است. در تب سفارش‌ها بالای
                    جدول آمده‌اند.
                </p>
            )}

            <div className="mt-5">
                <Async
                    loading={loading && data === null}
                    error={error}
                    empty={data !== null && data.stock.length === 0}
                    emptyText="هنوز کارتی تعریف نشده است. از تب تنظیمات یکی بسازید."
                    onRetry={() => void load()}
                    skeleton={
                        <div className="grid grid-cols-3 gap-2 sm:gap-4">
                            <div className="anim-pulse h-24 rounded-2xl border border-line bg-surface sm:h-40"></div>
                            <div className="anim-pulse h-24 rounded-2xl border border-line bg-surface sm:h-40"></div>
                            <div className="anim-pulse h-24 rounded-2xl border border-line bg-surface sm:h-40"></div>
                        </div>
                    }
                >
                    {/* Three across at every width. Stacked, three numbers cost a whole phone
                        screen - and "can I trade today" is a question that should cost a
                        glance. The supporting lines go `sr-only` rather than `hidden` below
                        `sm`: they are still read out, they just stop taking space. */}
                    <ul className="stagger grid grid-cols-3 gap-2 sm:gap-4">
                        {(data?.stock ?? []).map((line) => (
                            <li
                                key={line.amount}
                                className="rounded-2xl border border-line bg-surface p-3 text-center sm:p-5 sm:text-start"
                            >
                                <p className="text-caption text-muted sm:text-small">
                                    <span className="max-sm:sr-only">کارت </span>
                                    <span dir="ltr" className="latin inline-block">
                                        ${line.amount}
                                    </span>
                                </p>
                                {/* Zero is a state, not a quantity - and the Persian zero is a
                                    single dot, which at any size reads as a speck rather than
                                    as "you cannot sell this today". So it is a word. */}
                                {line.available > 0 ? (
                                    <>
                                        <p className="mt-1 text-2xl font-bold text-firouze sm:mt-2 sm:text-4xl">
                                            {count(line.available)}
                                        </p>
                                        <p className="mt-1 text-caption text-muted max-sm:sr-only">
                                            کد آماده فروش
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="mt-1 text-base font-bold text-danger sm:mt-2 sm:text-2xl">
                                            ناموجود
                                        </p>
                                        <p className="mt-1 text-caption text-danger max-sm:sr-only">
                                            کدی برای فروش نمانده است
                                        </p>
                                    </>
                                )}
                                {/* Two counts on two lines. Persian digits beside a middot read
                                    as one number: "۱ · ۱" is indistinguishable from "۱۰۱". */}
                                <dl className="mt-4 grid gap-1 text-caption text-muted max-sm:sr-only">
                                    <div className="flex justify-between gap-2">
                                        <dt>رزرو شده</dt>
                                        <dd>{count(line.held)}</dd>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                        <dt>فروخته شده</dt>
                                        <dd>{count(line.sold)}</dd>
                                    </div>
                                </dl>
                            </li>
                        ))}
                    </ul>
                </Async>
            </div>
        </AdminShell>
    );
}
