// The console's routes: the session, the ledger, the inventory, the catalogue, the settings.
//
// Everything here sits behind the admin guard except signing in. Read `services/settings.ts`
// alongside it - the write-only rule for credentials is enforced there, not in these
// handlers, so a new route cannot accidentally hand a secret back.
import { ConflictError, UnauthorizedError } from '@azerothjs/http';
import type { HandlersWithGuards } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import type { contract } from '../contract.ts';
import type { Store } from '../db/index.ts';
import { displayPhone, normalizePhone } from '../domain/phone.ts';
import type { SmsSender } from '../gateways/kavenegar.ts';
import { ADMIN_KEY_PATTERN, type Admin } from '../services/admin.ts';
import type { Settings } from '../services/settings.ts';

/** Rows per page. Enough to scan without scrolling twice; small enough to stay fast. */
const PAGE_SIZE = 25;

export interface AdminOptions
{
    store: Store;
    admin: Admin;
    settings: Settings;
    sms: SmsSender;
    callbackUrl: string;
    log?: Logger;
}

/** Typed from the CONTRACT, so a route without a matching handler fails to compile. */
export function adminHandlers(options: AdminOptions): HandlersWithGuards<typeof contract, Record<never, never>>['admin']
{
    const { store, admin, settings, sms, callbackUrl, log } = options;

    return {
        // --- The session ---

        signIn: (context: { request: Request; input: { key: string } }) => new Response(null, {
            status: 204,
            headers: { 'set-cookie': admin.signIn(context.request, context.input.key) }
        }),

        signOut: (context: { request: Request }) => new Response(null, {
            status: 204,
            headers: { 'set-cookie': admin.signOut(context.request) }
        }),

        // --- What is happening right now ---

        overview: () => ({ stock: store.stock(), owed: store.owedCount() }),

        orders: ({ query }: { query: { search?: string; page?: number } }) =>
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
        },

        // --- Inventory ---

        addCodes: ({ input }: { input: { amount: number; codes: string[] } }) => store.addCodes(input.amount, input.codes),

        codes: ({ query }: { query: { search?: string; state?: 'free' | 'held' | 'sold'; amount?: number; page?: number } }) =>
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
        },

        // --- The catalogue ---

        tiers: () => ({ tiers: store.tiers() }),

        saveTier: ({ input }: { input: Parameters<Store['saveTier']>[0] }) =>
        {
            store.saveTier(input);
            log?.info('tier saved', { amount: input.amount, toman: input.toman, active: input.active });
            return { tiers: store.tiers() };
        },

        removeTier: ({ input }: { input: { amount: number } }) =>
        {
            const outcome = store.removeTier(input.amount);
            log?.info('tier removed', { amount: input.amount, outcome });
            return { outcome };
        },

        // --- Runtime configuration ---

        settings: () => settings.view(callbackUrl),

        saveSettings: ({ input }: { input: Record<string, string | undefined> }) =>
        {
            // An ABSENT field keeps its value; an empty string is an explicit clear. That
            // distinction is what lets the console send only what changed without a blank
            // secret input wiping a working credential.
            settings.save(input);
            log?.warn('runtime settings changed', { fields: Object.keys(input) });
            return settings.view(callbackUrl);
        },

        settingsLog: () => ({ entries: settings.log(50) }),

        rotateKey: (context: { request: Request; input: { currentKey: string; newKey: string } }) =>
        {
            // A session proves someone was the admin at sign-in. Replacing the credential
            // should prove they still are, so the current key is required even though this
            // route already sits behind the guard.
            if (!settings.matchesAdminKey(context.input.currentKey))
            {
                throw new UnauthorizedError('کلید فعلی نادرست است');
            }
            if (!ADMIN_KEY_PATTERN.test(context.input.newKey))
            {
                throw new ConflictError('کلید تازه باید به شکل XXXX-XXXX-XXXX-XXXX باشد');
            }
            settings.rotateAdminKey(context.input.newKey);
            // Every open session dies with the old key, including this one: a rotation that
            // leaves the previous holder signed in has not rotated anything.
            admin.signOutAll();
            log?.warn('admin key rotated');
            return new Response(null, { status: 204, headers: { 'set-cookie': admin.signOut(context.request) } });
        },

        testSms: async ({ input }: { input: { phone: string } }) =>
        {
            const phone = normalizePhone(input.phone);
            if (phone === null)
            {
                throw new ConflictError('شماره موبایل معتبر نیست');
            }
            // A sample that looks like a code but is obviously not one: proving the template
            // is approved must not hand out anything redeemable.
            const result = await sms.sendCode(phone, 'TEST-0000-0000');
            return { ok: result.ok, reason: result.ok ? '' : result.reason };
        }
    };
}
