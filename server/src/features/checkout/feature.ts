// The buyer-facing routes: the shop, the checkout, the return from the bank, the receipt.
import { ConflictError, HttpError, NotFoundError, redirect, type App } from '@azerothjs/http';
import { feature } from '@azerothjs/http/api';
import type { Logger } from '@azerothjs/logger';

import type { Store } from '../../db/index.ts';
import { mintReceiptToken } from '../../domain/codes.ts';
import { displayPhone, normalizePhone } from '../../domain/phone.ts';
import { throttle } from '../../platform/throttle.ts';
import type { Settings } from '../settings/settings.ts';
import type { Checkout } from './checkout.ts';
import { catalog, payStartInput, payStartOutput, receipt, receiptQuery } from './schemas.ts';
import type { PaymentGateway } from './zarinpal.ts';

/**
 * How long a code stays reserved for a checkout that has not come back. Long enough for a
 * slow bank page and a one-time password, short enough that an abandoned tab does not sit
 * on stock all day.
 */
const HOLD_MS = 30 * 60 * 1000;

export interface PayOptions
{
    store: Store;
    settings: Settings;
    payment: PaymentGateway;
    checkout: Checkout;

    /** The absolute URL the gateway returns the buyer to. */
    callbackUrl: string;

    /** Where the buyer lands afterwards; the receipt token is appended. */
    resultPath: string;

    log?: Logger;
}

/**
 * The gateway's return. Deliberately NOT a declared route: no client calls it, it answers
 * with a redirect rather than a body, and its query string is written by a third party - so
 * it reads its two parameters by hand and defensively. Throttled because each hit can cost
 * one verify call to the gateway.
 */
export function mountPayCallback(app: App, options: PayOptions): void
{
    const { store, checkout, resultPath } = options;

    app.with(throttle(30, 60_000)).get('/api/pay/callback', async (context) =>
    {
        const authority = context.url.searchParams.get('Authority') ?? '';
        const order = authority === '' ? undefined : store.orderByAuthority(authority);
        if (order === undefined)
        {
            // A forged callback, or one for an order that no longer exists. The two are
            // indistinguishable from here and neither is told anything specific.
            return redirect(`${ resultPath }?pay=unknown`);
        }

        await checkout.settle(order, context.url.searchParams.get('Status') === 'OK');
        return redirect(`${ resultPath }?receipt=${ order.id }#purchase`);
    });
}

/** The shop. Public by design - only `start` costs anything downstream, so only it has a ceiling. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the route literal IS the type; naming it would erase per-route inference
export function payFeature(options: PayOptions)
{
    const { store, settings, payment, callbackUrl, log } = options;

    return feature('/pay', (routes) => ({
        catalog: routes.get('/catalog', { output: catalog }, () =>
        {
            // Only ACTIVE tiers reach the shop. A disabled card is not "hidden by the page" -
            // it never leaves the server, so nothing on the client can reveal an amount the
            // operator has withdrawn from sale.
            const stock = new Map(store.stock().map((line) => [line.amount, line.available]));
            return {
                appName: settings.current().appName,
                tiers: store.tiers().filter((tier) => tier.active).map((tier) => ({
                    amount: tier.amount,
                    toman: tier.toman,
                    available: stock.get(tier.amount) ?? 0,
                    title: tier.title,
                    blurb: tier.blurb,
                    sample: tier.sample,
                    recommended: tier.recommended
                }))
            };
        }),

        // One call here costs a gateway request downstream, which is what the ceiling is for.
        start: routes.with(throttle(8, 60_000)).post('/start', { input: payStartInput, output: payStartOutput }, async ({ input }) =>
        {
            // The schema proved the phone is valid; it does not canonicalise, so this is
            // where the buyer's typing becomes the one stored form.
            const phone = normalizePhone(input.phone);
            if (phone === null)
            {
                throw new ConflictError('شماره موبایل معتبر نیست');
            }

            // THIS IS WHERE THE `5 | 10 | 25` UNION WENT. The catalogue is editable, so the
            // schema can only prove the amount is a positive integer; proving it is a thing
            // we actually sell is a lookup, and it happens before a code is claimed or a
            // gateway is called. An unknown or withdrawn denomination is refused exactly as a
            // forged one used to be.
            const tier = store.sellableTier(input.amount);
            if (tier === undefined)
            {
                throw new ConflictError('این کارت برای فروش نیست');
            }

            const order = {
                id: mintReceiptToken(),
                amount: tier.amount,
                // The price comes from the TIER, never from the request - the same rule the
                // verify step keeps.
                toman: tier.toman,
                phone,
                createdAt: new Date().toISOString()
            };

            // Stock is claimed BEFORE the gateway is opened. A buyer is never sent to pay for
            // a card that has already been sold to someone else.
            if (!store.startOrder(order, HOLD_MS))
            {
                throw new ConflictError('این کارت فعلاً موجود نیست');
            }

            const opened = await payment.request({
                tomanAmount: order.toman,
                description: `خرید گیفت کارت ${ settings.current().appName } ${ input.amount } دلاری`,
                callbackUrl,
                phone
            });

            // One exit for every way the gateway can fail us, including handing back an
            // authority we already hold: an untrackable payment is worse than a refused one,
            // because the buyer would pay against an order we cannot find on the way back.
            // Either way the held code goes straight back to stock rather than sitting out
            // the hold window.
            const tracked = opened.ok && store.attachAuthority(order.id, opened.authority);
            if (!tracked)
            {
                store.abandonOrder(order.id);
                log?.error('could not open a trackable payment', {
                    amount: input.amount,
                    reason: opened.ok ? 'duplicate authority' : opened.reason
                });
                throw new HttpError(502, 'درگاه پرداخت در دسترس نیست. چند دقیقه بعد دوباره تلاش کنید.', { code: 'gateway-unavailable' });
            }

            return { payUrl: opened.payUrl };
        }),

        receipt: routes.get('/receipt', { query: receiptQuery, output: receipt }, ({ query }) =>
        {
            const order = store.orderById(query.token);
            // A pending order is indistinguishable from no order here: until the gateway has
            // answered there is nothing true to report.
            if (order === undefined || order.status === 'pending')
            {
                throw new NotFoundError('receipt');
            }
            return {
                outcome: order.status,
                amount: order.amount,
                toman: order.toman,
                phone: displayPhone(order.phone),
                code: order.code,
                refId: order.refId,
                smsDelivered: order.smsDelivered
            };
        })
    }));
}
