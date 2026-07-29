// The console's own routes: signing in, and the two read views an operator opens first.
//
// Signing in is the ONE route in the admin group that is not behind the admin guard - it is
// how you get past it. Everything else here is, so these handlers never re-check the session.
import type { HandlersWithGuards } from '@azerothjs/http/api';

import type { contract } from '../../contract/index.ts';
import type { Store } from '../../db/types.ts';
import { displayPhone } from '../../domain/phone.ts';
import type { Admin } from './session.ts';

/** Rows per page. Enough to scan without scrolling twice; small enough to stay fast. */
const PAGE_SIZE = 25;

export interface ConsoleOptions
{
    store: Store;
    admin: Admin;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type ConsoleHandlers = Pick<
    HandlersWithGuards<typeof contract, Record<never, never>>['admin'],
    'signIn' | 'signOut' | 'overview' | 'orders'
>;

export function consoleHandlers(options: ConsoleOptions): ConsoleHandlers
{
    const { store, admin } = options;

    return {
        // POST /api/admin/session
        signIn: (context: { request: Request; input: { key: string } }) => new Response(null, {
            status: 204,
            headers: { 'set-cookie': admin.signIn(context.request, context.input.key) }
        }),

        // DELETE /api/admin/session
        signOut: (context: { request: Request }) => new Response(null, {
            status: 204,
            headers: { 'set-cookie': admin.signOut(context.request) }
        }),

        // GET /api/admin/overview
        overview: () => ({ stock: store.stock(), owed: store.owedCount() }),

        // GET /api/admin/orders
        orders: ({ query }: { query: { search?: string; page?: number } }) =>
        {
            const page = Math.max(1, query.page ?? 1);
            const found = store.searchOrders({
                search: query.search ?? '',
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE
            });
            return {
                // The full phone and the delivered code are here because that is what
                // answering a support call requires - and exactly why this route is behind
                // a session and this page is never indexed.
                rows: found.rows.map((order) => ({
                    id: order.id,
                    amount: order.amount,
                    toman: order.toman,
                    phone: displayPhone(order.phone),
                    status: order.status,
                    code: order.code,
                    refId: order.refId,
                    smsDelivered: order.smsDelivered,
                    createdAt: order.createdAt
                })),
                total: found.total,
                page,
                pageSize: PAGE_SIZE
            };
        }
    };
}
