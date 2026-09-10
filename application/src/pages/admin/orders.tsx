// The ledger: who bought what, and what they got.
//
// Owed rows - money verified, no code delivered - are pinned to the top by the server,
// because they are the only rows that need a human rather than a glance.
import { Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../lib/api.ts';
import type { LedgerRow } from '../../../../server/src/contract/index.ts';
import { count, moment, toman } from '../../lib/format.ts';
import { useToasts } from '../../ui/toast.tsx';
import Async from '../../ui/async.tsx';
import Button from '../../ui/button.tsx';
import TextInput from '../../ui/text-input.tsx';
import AdminShell from './shell.tsx';
import { useAdminSession } from './session.tsx';

/** Persian for each state, plus the token colour that carries its weight. */
const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
    pending: { label: 'در انتظار پرداخت', tone: 'text-muted' },
    paid: { label: 'پرداخت شده', tone: 'text-firouze' },
    cancelled: { label: 'لغو شده', tone: 'text-muted' },
    failed: { label: 'ناموفق', tone: 'text-danger' }
};

export default function Orders(): ReactNode {
    const notify = useToasts();
    const session = useAdminSession();

    const [rows, setRows] = useState<LedgerRow[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [revealed, setRevealed] = useState<string | null>(null);

    const lastPage = Math.max(1, Math.ceil(total / pageSize));

    // The query the next load should use. Held in a ref so a load triggered from an event
    // handler reads the value that handler just set, rather than the render's stale copy.
    const query = useRef({ search: '', page: 1 });

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const found = await client.admin.orders({ query: { ...query.current } });
            setRows(found.rows);
            setTotal(found.total);
            setPageSize(found.pageSize);
        } catch (failure) {
            setError(failureText(failure, 'سفارش‌ها خوانده نشدند'));
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
        // A new search always starts at the beginning; staying on page 4 of the previous
        // result set is how an operator concludes there are no matches when there are.
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

    const copyCode = async (code: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(code);
            notify.success('کد کپی شد');
        } catch {
            notify.error('کپی نشد. کد را دستی انتخاب کنید.');
        }
    };

    return (
        <AdminShell>
            <h2 className="text-h3 font-bold">سفارش‌ها</h2>
            <p className="mt-2 text-small text-muted">
                ردیف‌های پرداخت‌شدهٔ بدون کد اول می‌آیند، بقیه از تازه به قدیم.
            </p>

            {/* One box, not four. Someone on a support call has the customer's number, or a
                code, or a reference - and should not have to know which field the system
                files it under. A partial number works: 0917، ۰۹۱۷ و 917 هر سه همان شماره را
                پیدا می‌کنند. */}
            <form className="mt-4 flex flex-wrap gap-2" noValidate onSubmit={runSearch}>
                <label className="sr-only" htmlFor="ledger-search">
                    جستجو در سفارش‌ها
                </label>
                <div className="relative min-w-0 flex-1">
                    <TextInput
                        id="ledger-search"
                        tone="surface"
                        className="ps-11 pe-4 text-small"
                        placeholder="ایمیل، کد، یا شمارهٔ پیگیری"
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
                            ? 'هنوز سفارشی ثبت نشده است.'
                            : 'سفارشی با این مشخصات پیدا نشد.'
                    }
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    {/* `table-cards` redraws these rows as stacked cards below `md`. On a phone
                        the table was 566px wide in a 311px window: status, amount, reference
                        and code - the four a support call asks for - were all past the edge. */}
                    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                        <table className="table-cards w-full text-start text-small">
                            <thead className="border-b border-line text-caption text-muted">
                                <tr>
                                    <th className="p-3 text-start font-normal">زمان</th>
                                    <th className="p-3 text-start font-normal">ایمیل</th>
                                    <th className="p-3 text-start font-normal">کارت</th>
                                    <th className="p-3 text-start font-normal">مبلغ</th>
                                    <th className="p-3 text-start font-normal">وضعیت</th>
                                    <th className="p-3 text-start font-normal">پیگیری</th>
                                    <th className="p-3 text-start font-normal">کد</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((order) => (
                                    <tr
                                        key={order.id}
                                        className={`border-b border-line/60 ${order.status === 'paid' && order.code === null ? 'bg-danger/5' : ''}`}
                                    >
                                        <td
                                            data-label="زمان"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-6"
                                        >
                                            {moment(order.createdAt)}
                                        </td>
                                        <td
                                            data-label="ایمیل"
                                            className="p-3 whitespace-nowrap max-md:order-1 max-md:font-bold"
                                        >
                                            <span dir="ltr" className="latin">
                                                {order.email}
                                            </span>
                                        </td>
                                        <td
                                            data-label="کارت"
                                            className="cell-inline p-3 whitespace-nowrap max-md:order-3"
                                        >
                                            <span dir="ltr" className="latin">
                                                ${order.amount}
                                            </span>
                                        </td>
                                        <td
                                            data-label="مبلغ"
                                            className="cell-inline p-3 whitespace-nowrap text-caption max-md:order-4"
                                        >
                                            {toman(order.toman)}
                                        </td>
                                        <td
                                            data-label="وضعیت"
                                            className={`cell-inline p-3 whitespace-nowrap font-bold max-md:order-2 ${STATUS_TEXT[order.status]?.tone ?? ''}`}
                                        >
                                            {STATUS_TEXT[order.status]?.label ?? order.status}
                                            {order.status === 'paid' &&
                                                !order.mailDelivered &&
                                                order.code !== null && (
                                                    <span className="block text-caption font-normal text-muted">
                                                        ایمیل نرفت
                                                    </span>
                                                )}
                                        </td>
                                        <td
                                            data-label="پیگیری"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-5"
                                        >
                                            <span dir="ltr" className="latin">
                                                {order.refId === null ? '-' : String(order.refId)}
                                            </span>
                                        </td>
                                        {/* `cell-action` only when there IS a code: the other two
                                            branches are values, and a value wants its label. */}
                                        <td
                                            data-label="کد"
                                            className={`p-3 whitespace-nowrap max-md:order-7 ${order.code === null ? '' : 'cell-action'}`}
                                        >
                                            {order.status === 'paid' && order.code === null ? (
                                                <span className="font-bold text-danger">
                                                    کد داده نشده
                                                </span>
                                            ) : order.code === null ? (
                                                <span className="text-muted">-</span>
                                            ) : revealed === order.id ? (
                                                <button
                                                    type="button"
                                                    className="py-1 text-caption break-all hover:text-firouze max-md:min-h-tap max-md:w-full max-md:rounded-xl max-md:border max-md:border-line max-md:px-3"
                                                    title="کپی کردن کد"
                                                    onClick={() => void copyCode(order.code ?? '')}
                                                >
                                                    <span dir="ltr" className="latin">
                                                        {order.code}
                                                    </span>
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="py-1 text-caption font-bold text-firouze hover:underline max-md:min-h-tap max-md:w-full max-md:rounded-xl max-md:border max-md:border-line"
                                                    onClick={() => setRevealed(order.id)}
                                                >
                                                    نمایش کد
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        {/* Word, comma, word - never digit-separator-digit. Persian numerals
                            beside a middot or a bare space read as one longer number. */}
                        <p className="text-caption text-muted">
                            {count(total)} سفارش، صفحهٔ {count(page)} از {count(lastPage)}
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
