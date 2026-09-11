// The buyer-facing routes: the shop, the checkout, the return from the bank, the receipt.
import type { FastifyInstance } from 'fastify';
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import { ConflictError, HttpError, NotFoundError } from '../../platform/http.ts';
import { throttle } from '../../platform/throttle.ts';
import type { contract } from '../../contract/index.ts';
import type { Store } from '../../db/index.ts';
import { mintReceiptToken } from '../../domain/codes.ts';
import { displayEmail, normalizeEmail } from '../../domain/email.ts';
import { tomanPrice } from '../../domain/pricing.ts';
import type { TetherRate } from '../rate/rate.ts';
import type { PaymentGateway } from './zarinpal.ts';
import type { Checkout } from './checkout.ts';
import type { Settings } from '../settings/settings.ts';

/**
 * How long a code stays reserved for a checkout that has not come back. Long enough for a
 * slow bank page and a one-time password, short enough that an abandoned tab does not sit
 * on stock all day.
 */
const HOLD_MS = 30 * 60 * 1000;

export interface PayOptions {
    store: Store;
    settings: Settings;

    /**
     * The tether rate the console set. Every price in this file comes from it, and a null
     * from `current()` closes the shop - see features/rate/rate.ts for why that is the right
     * outcome rather than a fallback number.
     */
    rate: TetherRate;

    payment: PaymentGateway;
    checkout: Checkout;

    /** The absolute URL the gateway returns the buyer to. Read PER PAYMENT - see app.ts. */
    callbackUrl: () => string;

    /** Where the buyer lands afterwards; the receipt token is appended. */
    resultPath: string;

    log?: Logger;
}

/** Only this feature's routes. app.ts mounts them as the whole `pay` group. */
type PayHandlers = Handlers<typeof contract>['pay'];

/**
 * The gateway's return. Deliberately NOT a contract route: no client calls it, it answers
 * with a redirect rather than a body, and its query string is written by a third party - so
 * it reads its two parameters by hand and defensively. Throttled because each hit can cost
 * one verify call to the gateway.
 *
 * The redirect is RELATIVE, and stays correct now that nginx serves the pages: the browser
 * resolves it against the public origin it asked on, which is the one place the shop lives.
 */
export function mountPayCallback(app: FastifyInstance, options: PayOptions): void {
    const { store, checkout, resultPath } = options;
    const limit = throttle(30, 60_000);

    app.get(
        '/api/pay/callback',
        {
            preHandler: async (request, reply) => {
                await limit({ request, reply });
            }
        },
        async (request, reply) => {
            const params = request.query as Record<string, string | undefined>;
            const authority = params.Authority ?? '';
            const order = authority === '' ? undefined : store.orderByAuthority(authority);
            if (order === undefined) {
                // A forged callback, or one for an order that no longer exists. The two are
                // indistinguishable from here and neither is told anything specific.
                return reply.redirect(`${resultPath}?pay=unknown`, 303);
            }

            await checkout.settle(order, params.Status === 'OK');
            return reply.redirect(`${resultPath}?receipt=${order.id}#purchase`, 303);
        }
    );
}

/**
 * Every handler under `pay`. The return type comes from the CONTRACT, so drift between a
 * route and its handler is a compile error here rather than a runtime 500.
 */
export function payHandlers(options: PayOptions): PayHandlers {
    const { store, settings, rate, payment, callbackUrl, log } = options;

    return {
        // GET /api/pay/catalog
        catalog: () => {
            // Only ACTIVE tiers reach the shop. A disabled card is not "hidden by the page" -
            // it never leaves the server, so nothing on the client can reveal an amount the
            // operator has withdrawn from sale.
            const stock = new Map(store.stock().map((line) => [line.amount, line.available]));

            // ONE rate for the whole response. Reading it per tier would let a save from
            // the console land mid-map and price three cards off two different rates.
            const live = rate.current();
            const margin = settings.current().marginPercent;

            return {
                appName: settings.current().appName,
                rate: live,
                tiers: store
                    .tiers()
                    .filter((tier) => tier.active)
                    .map((tier) => ({
                        amount: tier.amount,
                        toman: live === null ? null : tomanPrice(tier.amount, live.toman, margin),
                        available: stock.get(tier.amount) ?? 0,
                        title: tier.title,
                        blurb: tier.blurb,
                        recommended: tier.recommended
                    }))
            };
        },

        // POST /api/pay/start
        start: async ({ input }) => {
            // The schema proved the address is valid; it does not canonicalise, so this is
            // where the buyer's typing becomes the one stored form.
            const email = normalizeEmail(input.email);
            if (email === null) {
                throw new ConflictError('ایمیل معتبر نیست');
            }

            // THIS IS WHERE THE `5 | 10 | 25` UNION WENT. The catalogue is editable, so the
            // schema can only prove the amount is a positive integer; proving it is a thing
            // we actually sell is a lookup, and it happens before a code is claimed or a
            // gateway is called. An unknown or withdrawn denomination is refused exactly as a
            // forged one used to be.
            const tier = store.sellableTier(input.amount);
            if (tier === undefined) {
                throw new ConflictError('این کارت برای فروش نیست');
            }

            // No rate, no price, no sale. There is deliberately no fallback: the
            // alternative to refusing here is charging a number nobody can justify.
            const live = rate.current();
            if (live === null) {
                throw new HttpError(
                    503,
                    'قیمت تتر هنوز تنظیم نشده و خرید موقتاً ممکن نیست. کمی بعد دوباره تلاش کنید.',
                    { code: 'rate-unavailable', retryAfter: 60 }
                );
            }

            // THE REASON `quotedToman` EXISTS. The price is computed here, from our rate
            // and our margin - the request's number is never the amount. It is only compared
            // against, so that a buyer who was shown one figure can never be charged another:
            // if the console moved the rate while they were typing, this refuses and the card
            // re-quotes rather than quietly taking the difference.
            const price = tomanPrice(tier.amount, live.toman, settings.current().marginPercent);
            if (input.quotedToman !== price) {
                throw new HttpError(409, 'قیمت این کارت به‌روز شد. مبلغ تازه را ببینید.', {
                    code: 'price-changed'
                });
            }

            const order = {
                id: mintReceiptToken(),
                amount: tier.amount,
                // The price comes from OUR arithmetic, never from the request - the same rule
                // the verify step keeps, and the reason a moved rate cannot become a discount.
                toman: price,
                email,
                createdAt: new Date().toISOString()
            };

            // Stock is claimed BEFORE the gateway is opened. A buyer is never sent to pay for
            // a card that has already been sold to someone else.
            if (!store.startOrder(order, HOLD_MS)) {
                throw new ConflictError('این کارت فعلاً موجود نیست');
            }

            const opened = await payment.request({
                tomanAmount: order.toman,
                description: `خرید گیفت کارت ${settings.current().appName} ${input.amount} دلاری`,
                callbackUrl: callbackUrl(),
                email
            });

            // One exit for every way the gateway can fail us, including handing back an
            // authority we already hold: an untrackable payment is worse than a refused one,
            // because the buyer would pay against an order we cannot find on the way back.
            // Either way the held code goes straight back to stock rather than sitting out
            // the hold window.
            const tracked = opened.ok && store.attachAuthority(order.id, opened.authority);
            if (!tracked) {
                store.abandonOrder(order.id);
                log?.error(
                    {
                        amount: input.amount,
                        reason: opened.ok ? 'duplicate authority' : opened.reason
                    },
                    'could not open a trackable payment'
                );
                throw new HttpError(
                    502,
                    'درگاه پرداخت در دسترس نیست. چند دقیقه بعد دوباره تلاش کنید.',
                    { code: 'gateway-unavailable' }
                );
            }

            return { payUrl: opened.payUrl };
        },

        // GET /api/pay/receipt
        receipt: ({ query }) => {
            const order = store.orderById(query.token);
            // A pending order is indistinguishable from no order here: until the gateway has
            // answered there is nothing true to report.
            if (order === undefined || order.status === 'pending') {
                throw new NotFoundError('نتیجه‌ای برای این پرداخت پیدا نشد');
            }
            return {
                outcome: order.status,
                amount: order.amount,
                toman: order.toman,
                email: displayEmail(order.email),
                code: order.code,
                refId: order.refId,
                mailDelivered: order.mailDelivered
            };
        }
    };
}
