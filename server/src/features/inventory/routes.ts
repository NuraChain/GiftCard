// The inventory's handlers: pasting a batch of codes in, and auditing where they went.
//
// Codes are BEARER VALUES - whoever reads one can redeem it - so the search view returns
// them only to a signed-in console, and the buyer's phone is shown in its display form
// rather than the stored canonical one.
import type { Handlers } from '../../platform/api.ts';
import type { contract } from '../../contract/index.ts';
import type { Store } from '../../db/types.ts';
import { displayPhone } from '../../domain/phone.ts';

/** Rows per page. Enough to scan without scrolling twice; small enough to stay fast. */
const PAGE_SIZE = 25;

export interface InventoryOptions {
    store: Store;
}

/** Only this feature's routes. app.ts merges them into the `admin` group. */
type InventoryHandlers = Pick<Handlers<typeof contract>['admin'], 'addCodes' | 'codes'>;

export function inventoryHandlers(options: InventoryOptions): InventoryHandlers {
    const { store } = options;

    return {
        // POST /api/admin/codes
        addCodes: ({ input }) => store.addCodes(input.amount, input.codes),

        // GET /api/admin/codes
        codes: ({ query }) => {
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
        }
    };
}
