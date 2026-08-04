// The inventory's routes: pasting a batch of codes in, and auditing where they went.
//
// Codes are BEARER VALUES - whoever reads one can redeem it - so the search view returns
// them only to a signed-in console, and the buyer's phone is shown in its display form
// rather than the stored canonical one.
import type { Verbs } from '@azerothjs/http/api';

import type { Store } from '../../db/types.ts';
import { displayPhone } from '../../domain/phone.ts';
import { addCodesInput, addCodesResult, codePage, codeQuery } from './schemas.ts';

/** Rows per page. Enough to scan without scrolling twice; small enough to stay fast. */
const PAGE_SIZE = 25;

export interface InventoryOptions
{
    store: Store;
}

/** The inventory's half of the admin surface; app.ts lands it inside the guarded feature. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
export function inventoryRoutes(routes: Verbs<Record<never, never>, '/admin'>, options: InventoryOptions)
{
    const { store } = options;

    return {
        addCodes: routes.post('/codes', { input: addCodesInput, output: addCodesResult },
            ({ input }) => store.addCodes(input.amount, input.codes)),

        codes: routes.get('/codes', { query: codeQuery, output: codePage }, ({ query }) =>
        {
            const page = Math.max(1, query.page ?? 1);
            const found = store.searchCodes({
                search: query.search ?? '',
                state: query.state ?? null,
                amount: query.amount ?? null,
                limit: PAGE_SIZE,
                offset: (page - 1) * PAGE_SIZE
            });

            return {
                rows: found.rows.map((row) => ({
                    code: row.code,
                    amount: row.amount,
                    state: row.state,
                    addedAt: row.addedAt,
                    phone: row.phone === null ? null : displayPhone(row.phone),
                    soldAt: row.soldAt,
                    refId: row.refId
                })),
                total: found.total,
                page,
                pageSize: PAGE_SIZE
            };
        })
    };
}
