// Auditing where the stock went: every code, its state, and its buyer.
//
// Codes stay MASKED until asked for. A console that prints the whole inventory is one
// screenshot away from giving it away, and these are bearer values - whoever reads one can
// redeem it.
//
// `revision` is the parent's way of saying "a batch was just pasted, refetch". A prop rather
// than a shared context because the only thing that ever invalidates this list is the form on
// the same page.
import { Copy, Search, Ticket } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { client, failureText } from '../../../lib/api.ts';
import type { CodeRow, TierRow } from '../../../../../server/src/contract/index.ts';
import { count, moment } from '../../../lib/format.ts';
import { useToasts } from '../../../ui/toast.tsx';
import Async from '../../../ui/async.tsx';
import Button from '../../../ui/button.tsx';
import Select from '../../../ui/select.tsx';
import TextInput from '../../../ui/text-input.tsx';

type CodeState = 'free' | 'held' | 'sold';

/**
 * The inventory filters, in the order an operator asks the questions. The first entry
 * names the filter as well as clearing it, which is what lets the picker go unlabelled.
 */
const FILTERS: Array<{ label: string; state: CodeState | null }> = [
    { label: 'همهٔ وضعیت‌ها', state: null },
    { label: 'آماده فروش', state: 'free' },
    { label: 'رزرو شده', state: 'held' },
    { label: 'فروخته شده', state: 'sold' }
];

/** Persian for a code's state, with the token that carries its weight. */
const STATE_TEXT: Record<CodeState, { label: string; tone: string }> = {
    free: { label: 'آماده فروش', tone: 'text-firouze' },
    held: { label: 'رزرو شده', tone: 'text-gold' },
    sold: { label: 'فروخته شده', tone: 'text-muted' }
};

export interface InventoryTableProps {
    tiers: TierRow[];
    revision: number;
}

export default function InventoryTable({ tiers, revision }: InventoryTableProps): ReactNode {
    const notify = useToasts();

    const [rows, setRows] = useState<CodeRow[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [filterState, setFilterState] = useState<CodeState | null>(null);
    const [filterAmount, setFilterAmount] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [revealed, setRevealed] = useState<string | null>(null);

    const lastPage = Math.max(1, Math.ceil(total / pageSize));

    const stateOptions = FILTERS.map((item) => ({ value: item.state ?? '', label: item.label }));
    // Rebuilt from the catalogue rather than fixed: the denominations are the operator's to
    // change, so this list is however many cards they have defined today.
    const amountOptions = [
        { value: '', label: 'هر مبلغی' },
        ...tiers.map((tier) => ({
            value: String(tier.amount),
            label: `$${tier.amount}`,
            latin: true
        }))
    ];

    // The query the next load should use. Held in a ref so a load fired from a filter change
    // reads what that change just set rather than the render's stale copy.
    const query = useRef<{ search: string; state?: CodeState; amount?: number; page: number }>({
        search: '',
        page: 1
    });

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const found = await client.admin.codes({ query: { ...query.current } });
            setRows(found.rows);
            setTotal(found.total);
            setPageSize(found.pageSize);
        } catch (failure) {
            setError(failureText(failure, 'کدها خوانده نشدند'));
        } finally {
            setLoading(false);
        }
    }, []);

    // Refetches on the first render AND every time the parent bumps `revision` after a paste.
    useEffect(() => {
        void load();
    }, [revision, load]);

    /** Any change to a filter is a new question, so it starts at page one. */
    const applyFilter = (next: {
        state?: CodeState | null;
        amount?: number | null;
        search?: string;
    }): void => {
        const state = next.state === undefined ? filterState : next.state;
        const amount = next.amount === undefined ? filterAmount : next.amount;
        const term = next.search === undefined ? search : next.search;

        setFilterState(state);
        setFilterAmount(amount);
        setSearch(term);
        setPage(1);

        query.current = {
            search: term,
            state: state ?? undefined,
            amount: amount ?? undefined,
            page: 1
        };
        void load();
    };

    const goToPage = (next: number): void => {
        const target = Math.min(Math.max(1, next), lastPage);
        setPage(target);
        query.current = { ...query.current, page: target };
        void load();
    };

    /**
     * The clipboard leaves no trace on the page, so this is the one console action that
     * cannot confirm itself. Support reads or pastes a code far more often than it retypes one.
     */
    const copyCode = async (code: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(code);
            notify.success('کد کپی شد');
        } catch {
            notify.error('کپی نشد. کد را دستی انتخاب کنید.');
        }
    };

    return (
        <section className="mt-section">
            <h2 className="flex items-center gap-2 text-h3 font-bold">
                <Ticket className="size-5 text-firouze" aria-hidden="true" />
                موجودی
            </h2>
            <p className="mt-2 text-small text-muted">
                هر کدی که وارد کرده‌اید، به‌همراه وضعیت و خریدارش. تازه‌ترین کد اول.
            </p>

            <form
                className="mt-4 flex flex-wrap gap-2"
                noValidate
                onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    applyFilter({});
                }}
            >
                <label className="sr-only" htmlFor="code-search">
                    جستجو در کدها
                </label>
                <div className="relative min-w-0 flex-1">
                    <TextInput
                        id="code-search"
                        tone="surface"
                        className="ps-11 pe-4 text-small"
                        placeholder="بخشی از کد، یا شماره موبایل خریدار"
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
            </form>

            {/* Pickers, not chips. As chips these two filters wrapped onto three rows of a
                phone, and they grow with the catalogue - a shop with eight denominations
                would have had eleven buttons here. A picker is one row at any catalogue
                size, and on a phone it opens the platform's own list.

                Neither carries a visible label: the option that clears the filter also
                names it, so "همهٔ وضعیت‌ها" says what the closed picker is for. */}
            <div className="mt-3 flex gap-2">
                <Select
                    id="filter-state"
                    className="min-w-0 flex-1 sm:max-w-52"
                    label="وضعیت کد"
                    value={filterState ?? ''}
                    options={stateOptions}
                    onChange={(chosen) =>
                        applyFilter({ state: chosen === '' ? null : (chosen as CodeState) })
                    }
                />
                <Select
                    id="filter-amount"
                    className="min-w-0 flex-1 sm:max-w-40"
                    label="مبلغ کارت"
                    value={filterAmount === null ? '' : String(filterAmount)}
                    options={amountOptions}
                    onChange={(chosen) =>
                        applyFilter({ amount: chosen === '' ? null : Number(chosen) })
                    }
                />
            </div>

            <div className="mt-4">
                <Async
                    loading={loading}
                    error={error}
                    empty={rows.length === 0}
                    emptyText={
                        search === '' && filterState === null && filterAmount === null
                            ? 'هنوز کدی وارد نشده است.'
                            : 'کدی با این مشخصات نیست.'
                    }
                    onRetry={() => void load()}
                    skeleton={
                        <div className="anim-pulse h-64 rounded-2xl border border-line bg-surface"></div>
                    }
                >
                    {/* Cards below `md` - see the note on the same table in orders.tsx.
                        The reveal sits at the FOOT of each card rather than the head: the code
                        is masked, so what identifies a row on sight is its state and amount,
                        and leading with the button would make the page a stack of buttons. */}
                    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                        <table className="table-cards w-full text-start text-small">
                            <thead className="border-b border-line text-caption text-muted">
                                <tr>
                                    <th className="p-3 text-start font-normal">کد</th>
                                    <th className="p-3 text-start font-normal">کارت</th>
                                    <th className="p-3 text-start font-normal">وضعیت</th>
                                    <th className="p-3 text-start font-normal">خریدار</th>
                                    <th className="p-3 text-start font-normal">افزوده شد</th>
                                    <th className="p-3 text-start font-normal">فروخته شد</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.code} className="border-b border-line/60">
                                        <td
                                            data-label="کد"
                                            className="cell-action p-3 whitespace-nowrap max-md:order-6"
                                        >
                                            {revealed === row.code ? (
                                                <button
                                                    type="button"
                                                    className="flex items-center gap-2 py-1 text-caption hover:text-firouze max-md:min-h-tap max-md:w-full max-md:justify-center max-md:rounded-xl max-md:border max-md:border-line max-md:px-3"
                                                    title="کپی کردن کد"
                                                    onClick={() => void copyCode(row.code)}
                                                >
                                                    <span dir="ltr" className="latin break-all">
                                                        {row.code}
                                                    </span>
                                                    <Copy
                                                        className="size-3.5 shrink-0 text-muted"
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="py-1 text-caption font-bold text-firouze hover:underline max-md:min-h-tap max-md:w-full max-md:rounded-xl max-md:border max-md:border-line"
                                                    onClick={() => setRevealed(row.code)}
                                                >
                                                    نمایش کد
                                                </button>
                                            )}
                                        </td>
                                        <td
                                            data-label="کارت"
                                            className="cell-inline p-3 whitespace-nowrap max-md:order-2"
                                        >
                                            <span dir="ltr" className="latin">
                                                ${row.amount}
                                            </span>
                                        </td>
                                        <td
                                            data-label="وضعیت"
                                            className={`cell-inline p-3 whitespace-nowrap font-bold max-md:order-1 ${STATE_TEXT[row.state].tone}`}
                                        >
                                            {STATE_TEXT[row.state].label}
                                        </td>
                                        <td
                                            data-label="خریدار"
                                            className="cell-inline p-3 whitespace-nowrap max-md:order-3"
                                        >
                                            {row.phone === null ? (
                                                <span className="text-muted">-</span>
                                            ) : (
                                                <span dir="ltr" className="latin">
                                                    {row.phone}
                                                </span>
                                            )}
                                        </td>
                                        <td
                                            data-label="افزوده شد"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-4"
                                        >
                                            {moment(row.addedAt)}
                                        </td>
                                        <td
                                            data-label="فروخته شد"
                                            className="cell-inline p-3 whitespace-nowrap text-caption text-muted max-md:order-5"
                                        >
                                            {row.soldAt === null ? '-' : moment(row.soldAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <p className="text-caption text-muted">
                            {count(total)} کد، صفحهٔ {count(page)} از {count(lastPage)}
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
        </section>
    );
}
