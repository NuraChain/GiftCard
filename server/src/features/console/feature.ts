// The console's routes: the session, and the two read views an operator opens first.
//
// The KEY is only ever sent in a request body, never a query string: a URL lands in browser
// history, server logs and referrer headers, and a credential must be in none of those.
import type { Verbs } from '@azerothjs/http/api';

import type { Store } from '../../db/types.ts';
import { displayPhone } from '../../domain/phone.ts';
import { throttle } from '../../platform/throttle.ts';
import { adminKeyInput, adminOverview, ledgerPage, ledgerQuery } from './schemas.ts';
import type { Admin } from './session.ts';

/** Rows per page. Enough to scan without scrolling twice; small enough to stay fast. */
const PAGE_SIZE = 25;

export interface ConsoleOptions
{
    store: Store;
    admin: Admin;
}

/**
 * The console's half of the admin surface. It is declared as a BUILDER rather than its own
 * feature so that every admin route lands inside the one guarded feature in app.ts - see the
 * two `routes.only(...)` calls below for the only two ways past that guard.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
export function consoleRoutes(routes: Verbs<Record<never, never>, '/admin'>, options: ConsoleOptions)
{
    const { store, admin } = options;

    return {
        // Signing in IS how you get past requireAdmin, so it cannot sit behind it. `routes.only`
        // replaces the feature's chain, so this route has the ceiling and nothing else - and the
        // exemption is written AT the route, where it is greppable, instead of in a map three
        // files away.
        signIn: routes.only(throttle(10, 60_000)).post('/session', { input: adminKeyInput }, (context) =>
            new Response(null, {
                status: 204,
                headers: { 'set-cookie': admin.signIn(context.request, context.input.key) }
            })),

        // Signing out clears a cookie. Requiring the credential you are clearing would strand
        // whoever needs it most, so the empty chain here is deliberate.
        signOut: routes.only().del('/session', {}, (context) =>
            new Response(null, {
                status: 204,
                headers: { 'set-cookie': admin.signOut(context.request) }
            })),

        overview: routes.get('/overview', { output: adminOverview }, () => ({
            stock: store.stock(),
            owed: store.owedCount()
        })),

        orders: routes.get('/orders', { query: ledgerQuery, output: ledgerPage }, ({ query }) =>
        {
            const page = Math.max(1, query.page ?? 1);
            const found = store.searchOrders({
                search: query.search ?? '',
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE
            });

            return {
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
        })
    };
}
