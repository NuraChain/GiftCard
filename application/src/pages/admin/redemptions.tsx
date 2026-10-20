// The payout requests: every code cashed out, and where its value was asked to go.
//
// Rows nobody was told about are pinned to the top by the server and tinted here: each is a
// person waiting on a transfer the operator may never have heard about. The address is
// copied by a tap, because a hand-typed address is how USDT is lost.
import { Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../lib/api.ts';
import type { RedemptionRow } from '../../../../server/src/contract/index.ts';
import { count, moment } from '../../lib/format.ts';
import { useToasts } from '../../ui/toast.tsx';
import Async from '../../ui/async.tsx';
import Button from '../../ui/button.tsx';
import TextInput from '../../ui/text-input.tsx';
import AdminShell from './shell.tsx';
import { useAdminSession } from './session.tsx';

export default function Redemptions(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [rows, setRows] = useState<RedemptionRow[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const lastPage = Math.max(1, Math.ceil(total / pageSize));

    // See orders.tsx: a ref, so a load started from a handler reads what that handler set.
    const query = useRef({ search: '', page: 1 });

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const found = await client.admin.redemptions({ query: { ...query.current } });
            setRows(found.rows);
            setTotal(found.total);
            setPageSize(found.pageSize);
        } catch (failure) {
            setError(failureText(failure, 'درخواست‌های برداشت خوانده نشدند'));
        } finally {
            setLoading(false);
        }
    }, []);

    // Keyed on the session, not on mount - see the note in overview.tsx.
    useEffect(() => {
        if (session.unlocked) {
            void load();
        }
    }, [session.revision, session.unlocked, load]);

    const runSearch = (event: FormEvent): void => {
        event.preventDefault();
        setPage(1);
        query.current = { search, page: 1 };
        void load();
    };

    const goToPage = (next: number): void => {
        const target = Math.min(Math.max(1, next), lastPage);
        setPage(target);
        query.current = { search: query.current.search, page: target };
        void load();
    };

    const clearSearch = (): void => {
        setSearch('');
        setPage(1);
        query.current = { search: '', page: 1 };
        void load();
    };

    const copy = async (text: string, done: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            notify.success(done);
        } catch {
            notify.error('کپی نشد. متن را دستی انتخاب کنید.');
        }
    };

    return (
        <AdminShell>
            <h2 className="text-h3 font-bold">درخواست‌های برداشت</h2>
            <p className="mt-2 text-small text-muted">
                هر کدی که redeem شده، با مبلغ و آدرسی که برایش خواسته شده. انتقال را دستی انجام
                دهید. ردیف‌هایی که خبرشان به شما نرسیده بود اول می‌آیند، بقیه از تازه به قدیم.
            </p>

            <form className="mt-4 flex flex-wrap gap-2" noValidate onSubmit={runSearch}>
                <label className="sr-only" htmlFor="redemption-search">
                    جستجو در درخواست‌های برداشت
                </label>
                <div className="relative min-w-0 flex-1">
                    <TextInput
                        id="redemption-search"
                        tone="surface"
                        className="ps-11 pe-4 text-small"
                        placeholder="کد، آدرس کیف پول یا شماره موبایل خریدار"
                        value={search}
                        onChange={setSearch}
                    />
                    <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted">
                        <Search className="size-4" aria-hidden="true" />
                    </span>
                </div>
                <Button type="submit" disabled={loading}>
                    جستجو
                </Button>
                {search !== '' && (
                    <Button variant="ghost" onClick={clearSearch}>
                        پاک کردن
                    </Button>
                )}
            </form>

            <div className="mt-4">
                <Async
                    loading={loading}
                    error={error}
                    empty={rows.length === 0}
                    emptyText={
                        search === ''
                            ? 'هنوز هیچ کدی redeem نشده است.'
                            : 'درخواستی با این مشخصات پیدا نشد.'
                    }
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    {/* `table-cards` redraws these rows as stacked cards below `md` - see the
                        note on the same table in orders.tsx. */}
                    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                        <table className="table-cards w-full text-start text-small">
                            <thead className="border-b border-line text-caption text-muted">
                                <tr>
                                    <th className="p-3 text-start font-normal">زمان</th>
                                    <th className="p-3 text-start font-normal">مبلغ</th>
                                    <th className="p-3 text-start font-normal">شبکه</th>
                                    <th className="p-3 text-start font-normal">آدرس کیف پول</th>
                                    <th className="p-3 text-start font-normal">خریدار</th>
                                    <th className="p-3 text-start font-normal">اطلاع‌رسانی</th>
                                    <th className="p-3 text-start font-normal">کد</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr
                                        key={row.code}
                                        className={`border-b border-line/60 ${row.notified ? '' : 'bg-danger/5'}`}
                                    >
                                        <td
                                            data-label="زمان"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-6"
                                        >
                                            {moment(row.claimedAt)}
                                        </td>
                                        <td
                                            data-label="مبلغ"
                                            className="cell-inline p-3 whitespace-nowrap font-bold max-md:order-1"
                                        >
                                            <span dir="ltr" className="latin">
                                                ${row.amount} USDT
                                            </span>
                                        </td>
                                        <td
                                            data-label="شبکه"
                                            className="cell-inline p-3 whitespace-nowrap max-md:order-2"
                                        >
                                            <span dir="ltr" className="latin">
                                                {row.network}
                                            </span>
                                        </td>
                                        <td
                                            data-label="آدرس کیف پول"
                                            className="cell-action p-3 max-md:order-3"
                                        >
                                            <button
                                                type="button"
                                                className="py-1 text-caption break-all hover:text-firouze max-md:min-h-tap max-md:w-full max-md:rounded-xl max-md:border max-md:border-line max-md:px-3"
                                                title="کپی کردن آدرس"
                                                onClick={() => void copy(row.wallet, 'آدرس کپی شد')}
                                            >
                                                <span dir="ltr" className="latin">
                                                    {row.wallet}
                                                </span>
                                            </button>
                                        </td>
                                        <td
                                            data-label="خریدار"
                                            className="cell-inline p-3 whitespace-nowrap max-md:order-4"
                                        >
                                            <span dir="ltr" className="latin">
                                                {row.phone}
                                            </span>
                                        </td>
                                        <td
                                            data-label="اطلاع‌رسانی"
                                            className={`cell-inline p-3 whitespace-nowrap font-bold max-md:order-5 ${row.notified ? 'text-firouze' : 'text-danger'}`}
                                        >
                                            {row.notified ? 'خبر داده شد' : 'خبر نرسید'}
                                        </td>
                                        <td
                                            data-label="کد"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-7"
                                        >
                                            <span dir="ltr" className="latin">
                                                {row.code}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <p className="text-caption text-muted">
                            {count(total)} درخواست، صفحهٔ {count(page)} از {count(lastPage)}
                        </p>
                        <div className="ms-auto flex gap-2">
                            <Button
                                disabled={page <= 1 || loading}
                                onClick={() => goToPage(page - 1)}
                            >
                                تازه‌تر
                            </Button>
                            <Button
                                disabled={page >= lastPage || loading}
                                onClick={() => goToPage(page + 1)}
                            >
                                قدیمی‌تر
                            </Button>
                        </div>
                    </div>
                </Async>
            </div>
        </AdminShell>
    );
}
