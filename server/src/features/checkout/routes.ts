// The buyer-facing routes: the shop, the checkout, the return from the bank, the receipt -
// for both shops. The English one is paid through NOWPayments; see ./nowpayments.ts before its routes.
import { langOfCountry, shopName, type IntlLang } from '../../domain/langs.ts';
import { randomInt } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Logger } from '../../platform/logging.ts';

import type { Handlers } from '../../platform/api.ts';
import { ConflictError, HttpError, NotFoundError } from '../../platform/http.ts';
import { throttle } from '../../platform/throttle.ts';
import type { contract } from '../../contract/index.ts';
import type { Order, Store } from '../../db/index.ts';
import { mintReceiptToken } from '../../domain/codes.ts';
import { normalizeEmail } from '../../domain/email.ts';
import { displayPhone, normalizePhone } from '../../domain/phone.ts';
import { tomanPrice } from '../../domain/pricing.ts';
import type { TetherRate } from '../rate/rate.ts';
import type { PaymentGateway } from './zarinpal.ts';
import { ID_SHAPE, type NowPayments } from './nowpayments.ts';
import { NOWPAYMENTS_PREFIX, readReturn } from './gateway.ts';
import type { Checkout } from './checkout.ts';
import type { Settings } from '../settings/settings.ts';

/**
 * How long a code stays reserved for a checkout that has not come back. Long enough for a
 * slow bank page and a one-time password, short enough that an abandoned tab does not sit
 * on stock all day.
 */
const HOLD_MS = 30 * 60 * 1000;

/**
 * The same for an English order. Longer, because a crypto transfer is a wallet app, a network fee and a wait for the chain,
 * not a one-time password. A code held past this goes back to stock; a payment that confirms
 * afterwards is still honoured from whatever is free (see `settlePaid`).
 */
export const HOLD_EN_MINUTES = 60;

/**
 * How often one receipt may make the server go and ask NOWPayments. The English result page polls
 * while a payment confirms, and every ask is an outbound call - so a tab left open, or a
 * stranger holding a token, costs one call per this long and no more.
 */
const ASK_EVERY_MS = 15_000;

/**
 * Where the visitor's country can arrive from, first match wins: Cloudflare's own header, and
 * the names an nginx GeoIP module or another proxy is commonly set up to send. Lower case, as
 * Node hands headers over.
 */
const COUNTRY_HEADERS = [
    'cf-ipcountry',
    'x-country-code',
    'x-geoip-country',
    'x-vercel-ip-country'
];

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

    /** The English shop's gateway. Only OPENS invoices here; `payment` verifies them. */
    nowpayments: NowPayments;
    checkout: Checkout;

    /** The absolute URL the gateway returns the buyer to. Read PER PAYMENT - see app.ts. */
    callbackUrl: () => string;

    /** Where NOWPayments posts an invoice's state, and where its page sends the buyer back to. */
    nowPaymentsCallbackUrl: () => string;
    nowPaymentsReturnUrl: (lang: IntlLang) => string;

    /** Where the buyer lands afterwards; the receipt token is appended. */
    resultPath: string;

    /**
     * Whether a request comes from somebody signed in to the console. It decides ONE thing:
     * whether a gateway's refusal is explained in the answer or only in the log - see `start`.
     * Absent means nobody is, which is the safe way for a caller to forget it.
     */
    isOperator?: (request: FastifyRequest) => boolean;

    log?: Logger;
}

/** Only this feature's routes. app.ts mounts them as the whole `pay` group. */
type PayHandlers = Handlers<typeof contract>['pay'];

/**
 * The gateway's return. Deliberately NOT a contract route: no client calls it, it answers
 * with a redirect rather than a body, and its query string is written by a third party - so
 * it is read by hand and defensively, by `readReturn`, which knows both gateways' spellings.
 * ONE URL FOR BOTH: the gateway that opened an order is recorded on the order, so nothing has
 * to be inferred from which address the buyer came back to. Throttled because each hit can
 * cost one verify call to the gateway.
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
            const returned = readReturn(request.query as Record<string, unknown>);
            const order =
                returned === null ? undefined : store.orderByAuthority(returned.authority);
            if (returned === null || order === undefined) {
                // A forged callback, or one for an order that no longer exists. The two are
                // indistinguishable from here and neither is told anything specific.
                return reply.redirect(`${resultPath}?pay=unknown`, 303);
            }

            await checkout.settle(order, returned.saidOk);
            return reply.redirect(`${resultPath}?receipt=${order.id}#purchase`, 303);
        }
    );
}

/**
 * Points an English order at one of its NOWPayments payments, then settles it.
 *
 * The id comes from a stranger - the IPN body, or the address the buyer came back on - so it
 * is kept only once NOWPayments, asked with our key, says the payment is under this order's
 * invoice (`learn`). A forged or foreign id costs one lookup and is dropped. A known one is not
 * asked about again; the settle that follows reads it anyway.
 */
export async function pointAndSettle(
    options: Pick<PayOptions, 'store' | 'nowpayments' | 'checkout'>,
    order: Order,
    paymentId: string
): Promise<void> {
    const { store, nowpayments, checkout } = options;
    const authority = order.authority ?? '';
    if (
        order.status !== 'paid' &&
        ID_SHAPE.test(paymentId) &&
        authority.startsWith(NOWPAYMENTS_PREFIX)
    ) {
        const known = store.paymentsFor(authority).includes(paymentId);
        if (
            !known &&
            (await nowpayments.learn(authority.slice(NOWPAYMENTS_PREFIX.length), paymentId))
        ) {
            store.rememberPayment(authority, paymentId);
        }
    }
    await checkout.settle(store.orderById(order.id) ?? order, true);
}

/** @internal An id out of somebody else's JSON or form - a number or a string - as a string. */
function idField(raw: unknown): string {
    if (typeof raw === 'number' && Number.isSafeInteger(raw)) {
        return String(raw);
    }
    return typeof raw === 'string' ? raw : '';
}

/**
 * NOWPayments' IPN: a payment's state, posted whenever it changes.
 *
 * A NUDGE, NOT A WITNESS - rule 5 in ./nowpayments.ts. Only `invoice_id` and `payment_id` are
 * read: the first finds the order, the second is checked with NOWPayments before it is kept,
 * and whether anything was paid is then read with our own key through the same `settle`
 * every other payment goes through. So the HMAC NOWPayments signs this with is not checked:
 * a forged post can make the server look a payment up, and nothing more.
 *
 * IT ANSWERS AT ONCE AND SETTLES AFTER. NOWPayments gives the callback three seconds, and a
 * settlement is an outbound read plus an email. Answering late would only make it retry.
 * It answers 200 to everything, known order or not: a refusal would teach a stranger which
 * ids are real.
 *
 * Mounted in its OWN SCOPE so that a form body is accepted here and nowhere else. Accepting
 * forms app-wide would open every cookie-guarded console route to a cross-site form post;
 * accepting them here costs nothing, since this route believes no body at all.
 */
export function mountNowPaymentsCallback(app: FastifyInstance, options: PayOptions): void {
    const { store, log } = options;
    const limit = throttle(60, 60_000);

    app.register((scope, _opts, done) => {
        scope.addContentTypeParser(
            'application/x-www-form-urlencoded',
            { parseAs: 'string' },
            (_request, body, parsed) => {
                parsed(null, Object.fromEntries(new URLSearchParams(String(body))));
            }
        );

        scope.post(
            '/api/pay/nowpayments',
            {
                preHandler: async (request, reply) => {
                    await limit({ request, reply });
                }
            },
            async (request, reply) => {
                const body = request.body as Record<string, unknown> | null | undefined;
                const invoiceId = idField(body?.invoice_id);
                const order = ID_SHAPE.test(invoiceId)
                    ? store.orderByAuthority(`${NOWPAYMENTS_PREFIX}${invoiceId}`)
                    : undefined;
                if (order === undefined) {
                    log?.warn('nowpayments callback for no known invoice');
                } else {
                    pointAndSettle(options, order, idField(body?.payment_id)).catch(
                        (error: unknown) => {
                            log?.error({ err: error }, 'nowpayments callback could not settle');
                        }
                    );
                }
                return reply.send({ ok: true });
            }
        );
        done();
    });
}

/**
 * Every handler under `pay`. The return type comes from the CONTRACT, so drift between a
 * route and its handler is a compile error here rather than a runtime 500.
 */
export function payHandlers(options: PayOptions): PayHandlers {
    const { store, settings, rate, payment, nowpayments, callbackUrl, isOperator, log } = options;

    /** When each English receipt last made us ask NOWPayments. Pruned as it is read. */
    const asked = new Map<string, number>();

    /**
     * The English receipt's fallback for a callback that never came: an unsettled NOWPayments
     * order is asked about once per `ASK_EVERY_MS`, and settled if the answer is in. A lost
     * callback then costs the buyer a few seconds rather than their code.
     *
     * `paymentId` is the one NOWPayments put on the address it sent the buyer back to, when
     * the page has it - which is how an order whose IPN never arrived learns its payment.
     */
    async function askNowPayments(order: Order, paymentId: string): Promise<Order> {
        const now = Date.now();
        for (const [id, at] of asked) {
            if (now - at >= ASK_EVERY_MS) {
                asked.delete(id);
            }
        }
        if (asked.has(order.id)) {
            return order;
        }
        asked.set(order.id, now);
        await pointAndSettle(options, order, paymentId);
        return store.orderById(order.id) ?? order;
    }

    return {
        // GET /api/pay/locale
        //
        // Where the visitor is, as a language - for a first visit to the bare address only
        // (application/src/lib/first-visit.ts). The country comes from a header the edge in
        // front of this server adds, never from a lookup here: no address leaves for a
        // third-party service, and no database of addresses ships with the shop.
        //
        // A header anybody could forge is fine for this: the most a forged one does is open
        // the shop in another language, which the visitor can change with one tap.
        locale: ({ request }) => {
            for (const name of COUNTRY_HEADERS) {
                const value = request.headers[name];
                const country = Array.isArray(value) ? value[0] : value;
                if (typeof country === 'string' && /^[A-Za-z]{2}$/.test(country.trim())) {
                    return { lang: langOfCountry(country) };
                }
            }
            return { lang: null };
        },

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
                appNames: settings.current().appNames,
                tiers: store
                    .tiers()
                    .filter((tier) => tier.active)
                    .map((tier) => ({
                        amount: tier.amount,
                        toman: live === null ? null : tomanPrice(tier.amount, live.toman, margin),
                        available: stock.get(tier.amount) ?? 0,
                        title: tier.title,
                        blurb: tier.blurb,
                        titleEn: tier.titleEn,
                        blurbEn: tier.blurbEn,
                        recommended: tier.recommended
                    })),
                englishOpen: settings.current().nowPaymentsApiKey !== ''
            };
        },

        // POST /api/pay/start
        start: async ({ input, request }) => {
            // The schema proved the number is valid; it does not canonicalise, so this is
            // where the buyer's typing becomes the one stored form.
            const phone = normalizePhone(input.phone);
            if (phone === null) {
                throw new ConflictError('شماره موبایل معتبر نیست');
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
                phone,
                lang: 'fa' as const,
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
                callbackUrl: callbackUrl()
            });

            // One exit for every way the gateway can fail us, including handing back an
            // authority we already hold: an untrackable payment is worse than a refused one,
            // because the buyer would pay against an order we cannot find on the way back.
            // Either way the held code goes straight back to stock rather than sitting out
            // the hold window.
            const tracked = opened.ok && store.attachAuthority(order.id, opened.authority);
            if (!tracked) {
                const reason = opened.ok ? 'duplicate authority' : opened.reason;
                store.abandonOrder(order.id);
                log?.error({ amount: input.amount, reason }, 'could not open a trackable payment');

                // 503, NOT THE 502 THIS IS. The shop sits behind a CDN, and a 502 from here
                // reached the browser as the CDN's own sixteen-byte "error code: 502" - the
                // sentence below never arrived, and the card had nothing to say but a generic
                // line. A 503 is the same promise to the buyer ("not now, try again") under a
                // status that is passed through with its body.
                //
                // THE REASON GOES TO THE OPERATOR AND TO NOBODY ELSE. It names the gateway,
                // repeats its refusal and can quote a page from whatever answered instead -
                // exactly what somebody fixing the shop needs in their browser console, and a
                // description of how this installation is set up for anybody else. A buyer
                // gets the sentence; the log has the rest either way.
                throw new HttpError(
                    503,
                    'درگاه پرداخت در دسترس نیست. چند دقیقه بعد دوباره تلاش کنید.',
                    {
                        code: 'gateway-unavailable',
                        details: isOperator?.(request) === true ? { reason } : undefined
                    }
                );
            }

            return { payUrl: opened.payUrl };
        },

        // POST /api/pay/start-en
        //
        // The English shop's checkout. It follows `start` above step for step - the same
        // sellable-tier check, the same claim before the gateway, the same single exit when
        // the gateway fails - and differs where the English shop does: an email instead of a
        // mobile, the face value in dollars instead of a Toman quote, and NOWPayments whichever
        // gateway the Persian shop is on. Its refusals are in English, for the page that
        // shows them.
        startEn: async ({ input, request }) => {
            const email = normalizeEmail(input.email);
            if (email === null) {
                throw new ConflictError('Enter a valid email address');
            }
            const tier = store.sellableTier(input.amount);
            if (tier === undefined) {
                throw new ConflictError('This card is not for sale');
            }
            if (settings.current().nowPaymentsApiKey === '') {
                throw new HttpError(503, 'Payments are not open yet. Please try again later.', {
                    code: 'gateway-unavailable',
                    retryAfter: 60
                });
            }

            const order = {
                id: mintReceiptToken(),
                amount: tier.amount,
                // No Toman: an English order is charged `amount`, in dollars.
                toman: 0,
                phone: email,
                lang: 'en' as const,
                createdAt: new Date().toISOString()
            };
            if (!store.startOrder(order, HOLD_EN_MINUTES * 60 * 1000)) {
                throw new ConflictError('This card is out of stock right now');
            }

            const opened = await nowpayments.request({
                usdAmount: tier.amount,
                // Twelve digits: unique enough for one shop, and an exact integer on both ends.
                orderNumber: randomInt(100_000_000_000, 999_999_999_999),
                orderName: `${shopName('en', settings.current().appName, settings.current().appNames)} $${tier.amount} gift card`,
                callbackUrl: options.nowPaymentsCallbackUrl(),
                returnUrl: options.nowPaymentsReturnUrl(input.lang)
            });

            // The same single exit as `start`, for the same reasons.
            const tracked =
                opened.ok &&
                store.attachAuthority(order.id, `${NOWPAYMENTS_PREFIX}${opened.authority}`);
            if (!tracked) {
                const reason = opened.ok ? 'duplicate authority' : opened.reason;
                store.abandonOrder(order.id);
                log?.error(
                    { amount: input.amount, reason },
                    'could not open a NOWPayments invoice'
                );
                throw new HttpError(
                    503,
                    'The payment gateway is unavailable. Please try again in a few minutes.',
                    {
                        code: 'gateway-unavailable',
                        details: isOperator?.(request) === true ? { reason } : undefined
                    }
                );
            }

            return { payUrl: opened.payUrl, receipt: order.id };
        },

        // GET /api/pay/receipt
        receipt: async ({ query }) => {
            let order = store.orderById(query.token);
            if (
                order?.status === 'pending' &&
                order.lang === 'en' &&
                order.authority?.startsWith(NOWPAYMENTS_PREFIX) === true
            ) {
                order = await askNowPayments(order, query.payment ?? '');
            }

            // A pending PERSIAN order is indistinguishable from no order here: until the bank
            // has answered there is nothing true to report. A pending English one is a payment
            // confirming on the chain, and saying so is the truth.
            if (order === undefined || (order.status === 'pending' && order.lang !== 'en')) {
                throw new NotFoundError(
                    order?.lang === 'en'
                        ? 'No result was found for this payment'
                        : 'نتیجه‌ای برای این پرداخت پیدا نشد'
                );
            }
            return {
                outcome: order.status,
                amount: order.amount,
                toman: order.toman,
                lang: order.lang,
                phone: displayPhone(order.phone),
                code: order.code,
                refId: order.refId,
                smsDelivered: order.smsDelivered
            };
        }
    };
}
