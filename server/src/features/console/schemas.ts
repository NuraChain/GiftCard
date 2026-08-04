// The console's wire shapes: the session, and the two read views an operator opens first.
//
// CLIENT-SAFE. Like every features/*/schemas.ts, this may import only `@azerothjs/schema` and
// `domain/` - anything else would drag the server into the browser bundle.
import { array, boolean, literal, number, object, string, union, type Infer } from '@azerothjs/schema';

import { amountField } from '../../domain/amount.ts';

export const adminKeyInput = object({ key: string({ trim: true, max: 32 }) });

/** One denomination's inventory. `held` is reserved by a checkout that has not settled. */
export const stockLine = object({
    amount: amountField,
    available: number({ int: true }),
    held: number({ int: true }),
    sold: number({ int: true })
});

export const adminOverview = object({
    stock: array(stockLine),

    /** Paid orders with no code: money taken, nothing delivered. The count that needs a human. */
    owed: number({ int: true })
});

/**
 * A ledger row. It carries the full phone and the delivered code because that is what
 * answering a support call requires - and it is exactly why this endpoint is behind a
 * session and this page is not indexed.
 */
export const ledgerRow = object({
    id: string(),
    amount: amountField,
    toman: number({ int: true }),
    phone: string(),
    status: union([literal('pending'), literal('paid'), literal('cancelled'), literal('failed')]),
    code: string().nullable(),
    refId: number({ int: true }).nullable(),
    smsDelivered: boolean(),
    createdAt: string()
});

/**
 * One page of the ledger. `search` is one box, not four: an operator holding a phone call
 * has the customer's number, or a code, or a reference - and should not have to know which
 * field the system files it under.
 */
export const ledgerQuery = object({
    search: string({ trim: true, max: 64 }).optional(),
    // A query string carries text, so the page number arrives as one: `coerce` is what
    // makes `?page=2` a number rather than a 422.
    page: number({ int: true, min: 1, coerce: true }).optional()
});

export const ledgerPage = object({
    rows: array(ledgerRow),

    /** Rows matching the search, across every page - what the page counter divides. */
    total: number({ int: true }),
    page: number({ int: true }),
    pageSize: number({ int: true })
});

export type AdminOverview = Infer<typeof adminOverview>;
export type StockLine = Infer<typeof stockLine>;
export type LedgerPage = Infer<typeof ledgerPage>;
export type LedgerRow = Infer<typeof ledgerRow>;
