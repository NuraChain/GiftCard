// The console's own wire shapes and routes: the session, and the two read views.
//
// The KEY is only ever sent in a request body, never a query string: a URL lands in browser
// history, server logs and referrer headers, and a credential must be in none of those.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { del, get, post } from '../../platform/contract.ts';
import { amountField } from '../../contract/shared.ts';

export const adminKeyInput = z.object({ key: z.string().trim().max(32) });

// --- What is happening right now ---

/** One denomination's inventory. `held` is reserved by a checkout that has not settled. */
export const stockLine = z.object({
    amount: amountField,
    available: z.number().int(),
    held: z.number().int(),
    sold: z.number().int()
});

export const adminOverview = z.object({
    stock: z.array(stockLine),

    /** Paid orders with no code: money taken, nothing delivered. The count that needs a human. */
    owed: z.number().int()
});

/**
 * A ledger row. It carries the full address and the delivered code because that is what
 * answering a support call requires - and it is exactly why this endpoint is behind a
 * session and this page is not indexed.
 */
export const ledgerRow = z.object({
    id: z.string(),
    amount: amountField,
    toman: z.number().int(),
    email: z.string(),
    status: z.enum(['pending', 'paid', 'cancelled', 'failed']),
    code: z.string().nullable(),
    refId: z.number().int().nullable(),
    mailDelivered: z.boolean(),
    createdAt: z.string()
});

/**
 * One page of the ledger. `search` is one box, not four: an operator holding a support call
 * has the customer's number, or a code, or a reference - and should not have to know which
 * field the system files it under.
 */
export const ledgerQuery = z.object({
    search: z.string().trim().max(64).optional(),
    // A query string carries text, so the page number arrives as one: the coercion is what
    // makes `?page=2` a number rather than a 422.
    page: z.coerce.number().int().min(1).optional()
});

export const ledgerPage = z.object({
    rows: z.array(ledgerRow),

    /** Rows matching the search, across every page - what the page counter divides. */
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int()
});

export type AdminOverview = z.infer<typeof adminOverview>;
export type StockLine = z.infer<typeof stockLine>;
export type LedgerPage = z.infer<typeof ledgerPage>;
export type LedgerRow = z.infer<typeof ledgerRow>;

/** This feature's routes. They join the `admin` group in ../../contract/index.ts. */
export const consoleRoutes = {
    signIn: post('/admin/session', { input: adminKeyInput }),
    signOut: del('/admin/session'),
    overview: get('/admin/overview', { output: adminOverview }),
    orders: get('/admin/orders', { query: ledgerQuery, output: ledgerPage })
};
