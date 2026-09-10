// The whole integration-testing story in one line: `app.inject(...)` - Fastify's own
// in-process dispatch, so there is no socket, no port, and no test server.
//
// The gateway and the SMS provider are INJECTED fakes; the database is a real SQLite
// running in memory. So every claim about money below is tested against the engine that
// ships, and none of it needs a merchant account, an API key, or a network.
//
// WHAT THESE TESTS DO NOT PROVE: that Zarinpal and Kavenegar behave as documented. Their
// wire shapes here are transcribed from their published docs, not observed from a live
// call. The first real payment is still the first real payment.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import { createAdmin } from '../src/features/console/session.ts';
import { buildApp } from '../src/app.ts';
import type {
    PaymentGateway,
    RequestResult,
    VerifyResult
} from '../src/features/checkout/zarinpal.ts';
import { seedTiers } from '../src/domain/seed.ts';
import { createSettings, type Settings } from '../src/features/settings/settings.ts';
import type { SmsResult, SmsSender } from '../src/features/checkout/sms.ts';
import { createStore, type Store } from '../src/db/index.ts';

const ADMIN_KEY = 'ABCD-EFGH-JKLM-NPQR';
const PRICES = { 5: 350_000, 10: 700_000, 25: 1_750_000 } as const;

/** A code inventory that looks like the real thing: canonical UUIDs. */
function uuids(length: number): string[] {
    return Array.from({ length }, () => crypto.randomUUID());
}

interface Fakes {
    payment: PaymentGateway;

    /** Every (authority, amount) pair verify was called with - the security assertions read this. */
    verifyCalls: Array<{ authority: string; toman: number }>;
    verifyResult: VerifyResult;

    /**
     * Forces `request` to answer with this instead of minting a fresh authority. Null - the
     * default - makes the fake behave like the real gateway, which never repeats one.
     */
    requestOverride: RequestResult | null;

    /** Every description the gateway was asked to show the buyer. */
    descriptions: string[];

    opened: number;
    sms: SmsSender;
    smsSent: Array<{ phone: string; code: string }>;
    smsResult: SmsResult;
}

function fakes(): Fakes {
    const state: Fakes = {
        verifyCalls: [],
        smsSent: [],
        requestOverride: null,
        descriptions: [],
        opened: 0,
        verifyResult: { ok: true, refId: 987654, alreadyVerified: false },
        smsResult: { ok: true },
        payment: {
            request: (input) => {
                state.descriptions.push(input.description);
                if (state.requestOverride !== null) {
                    return Promise.resolve(state.requestOverride);
                }
                state.opened += 1;
                const authority = `A${String(state.opened).padStart(35, '0')}`;
                return Promise.resolve({
                    ok: true,
                    authority,
                    payUrl: `https://gateway.test/pay/${authority}`
                });
            },
            verify: (authority, toman) => {
                state.verifyCalls.push({ authority, toman });
                return Promise.resolve(state.verifyResult);
            }
        },
        sms: {
            sendCode: (phone, code) => {
                state.smsSent.push({ phone, code });
                return Promise.resolve(state.smsResult);
            }
        }
    };
    return state;
}

let store: Store;
let fake: Fakes;
let settings: Settings;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
    store = createStore(':memory:');
    fake = fakes();
    // The catalogue is data now, so every test starts from the same seeded shop the first
    // boot would produce.
    for (const tier of seedTiers()) {
        store.saveTier(tier);
    }
    settings = createSettings({ store, adminKey: ADMIN_KEY });
    app = buildApp({
        store,
        settings,
        payment: fake.payment,
        sms: fake.sms,
        admin: createAdmin({
            matches: (candidate) => settings.matchesAdminKey(candidate),
            secureCookie: false
        }),
        callbackUrl: 'http://local/api/pay/callback'
    });
});

/**
 * What a call gives back. `inject` answers with Fastify's own response object; this is the
 * small surface the assertions below actually use, kept in the shape they were written
 * against so the suite reads the same after the move off the old framework.
 */
interface Answer {
    status: number;
    headers: { get(name: string): string | null };
    json<T = unknown>(): T;
    text(): string;
}

async function send(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
): Promise<Answer> {
    const response = await app.inject({
        method,
        url: path,
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        payload: body === undefined ? undefined : JSON.stringify(body)
    });

    return {
        status: response.statusCode,
        headers: {
            get: (name) => {
                const value = response.headers[name.toLowerCase()];
                if (value === undefined) {
                    return null;
                }
                return Array.isArray(value) ? String(value[0]) : String(value);
            }
        },
        json: <T = unknown>() => response.json() as T,
        text: () => response.body
    };
}

// One Fastify instance and one connection per test, both handed back afterwards. A suite
// that leaks either runs fine and then hangs the runner on the way out.
afterEach(async () => {
    await app.close();
    store.close();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Answer> {
    return send('POST', path, body, headers);
}

function get(path: string, headers: Record<string, string> = {}): Promise<Answer> {
    return send('GET', path, undefined, headers);
}

/**
 * Runs a checkout up to the point the browser would leave for the gateway.
 *
 * `amount` is a plain number, not `5 | 10 | 25`. That union was this helper's last trace of
 * a fixed catalogue, and it contradicted the test below that creates a $50 tier at runtime
 * and buys it. Whether an amount is sellable is a lookup against the live tier table now -
 * see the note on `amountField` in the contract.
 */
async function buy(amount = 10, phone = '09170459330'): Promise<number> {
    return (await post('/api/pay/start', { amount, phone })).status;
}

/** The authority and receipt token of the most recent order. */
function lastOrder(): { authority: string; token: string } {
    const order = store.recentOrders(1)[0];
    return { authority: order.authority ?? '', token: order.id };
}

describe('the shop', () => {
    it('answers the health probe', async () => {
        expect((await get('/api/healthz')).status).toBe(200);
    });

    it('reports stock, price and copy per denomination', async () => {
        store.addCodes(10, uuids(3));
        const body = (await (await get('/api/pay/catalog')).json()) as {
            tiers: Array<{
                amount: number;
                toman: number;
                available: number;
                title: string;
                recommended: boolean;
            }>;
        };
        expect(body.tiers).toHaveLength(3);

        const ten = body.tiers.find((tier) => tier.amount === 10);
        expect(ten?.toman).toBe(700_000);
        expect(ten?.available).toBe(3);
        // The card's words come from the catalogue too, so a tier added at runtime is not a
        // blank card on the shop.
        expect(ten?.title).toBe('کارت ده دلاری');
        expect(ten?.recommended).toBe(true);
        expect(body.tiers.find((tier) => tier.amount === 5)?.available).toBe(0);
    });

    it('does not offer a withdrawn denomination at all', async () => {
        store.saveTier({ ...seedTiers()[0], active: false });
        const body = (await (await get('/api/pay/catalog')).json()) as {
            tiers: Array<{ amount: number }>;
        };
        // Not "hidden by the page": an inactive tier never leaves the server, so nothing on
        // the client can reveal an amount the operator has taken off sale.
        expect(body.tiers.map((tier) => tier.amount)).toEqual([10, 25]);
    });

    it('refuses an amount that is not a sellable tier', async () => {
        // THE GUARANTEE THE `5 | 10 | 25` UNION USED TO GIVE. The catalogue is editable, so
        // the schema can only prove the amount is a positive integer; that 7 dollars is not
        // a thing we sell is now a lookup against the live tier table, and it happens before
        // a code is claimed or a gateway is called.
        store.addCodes(10, uuids(1));
        expect((await post('/api/pay/start', { amount: 7, phone: '09170459330' })).status).toBe(
            409
        );
        expect(fake.opened).toBe(0);
        expect(store.availableFor(10)).toBe(1);
    });

    it('refuses a denomination the operator has taken off sale', async () => {
        store.addCodes(5, uuids(1));
        const five = seedTiers()[0];
        store.saveTier({ ...five, active: false });

        // Disabling has to mean unbuyable, not merely hidden - otherwise a stale page or a
        // hand-written request still sells it.
        expect(await buy(5)).toBe(409);
        expect(fake.opened).toBe(0);
        expect(store.availableFor(5)).toBe(1);
    });

    it('charges the tier price, not one from the request', async () => {
        store.addCodes(10, uuids(1));
        const ten = seedTiers()[1];
        store.saveTier({ ...ten, toman: 999_000 });

        await buy(10);
        const order = store.recentOrders(1)[0];
        // Repricing takes effect on the next checkout with no restart, and the stored order
        // carries the price it was actually sold at.
        expect(order.toman).toBe(999_000);
    });

    it('rejects a malformed phone with a field map the form can display', async () => {
        const response = await post('/api/pay/start', { amount: 5, phone: '12345' });
        expect(response.status).toBe(422);
        const body = (await response.json()) as {
            error: { details?: { fields?: Record<string, string> } };
        };
        expect(Object.keys(body.error.details?.fields ?? {})).toContain('phone');
    });

    it('refuses to sell what it does not have', async () => {
        // Nothing in stock. The buyer must never be sent to a payment page for a card that
        // cannot be delivered.
        expect(await buy(25)).toBe(409);
    });

    it('holds a code for the buyer as soon as checkout starts', async () => {
        store.addCodes(10, uuids(1));
        expect(await buy(10)).toBe(200);
        expect(store.availableFor(10)).toBe(0);
        expect(store.stock().find((line) => line.amount === 10)?.held).toBe(1);
    });

    it('gives the code back when the gateway refuses to open a payment', async () => {
        store.addCodes(5, uuids(1));
        fake.requestOverride = { ok: false, reason: 'request failed (code -9)' };
        expect(await buy(5)).toBe(502);
        // An order that never reached the gateway must not sit on stock for half an hour.
        expect(store.availableFor(5)).toBe(1);
    });

    it('refuses a payment it could not track, and keeps the code', async () => {
        store.addCodes(10, uuids(2));
        // The gateway hands back the SAME handle twice. An order we cannot find on the way
        // back is worse than a refused one, so the second is refused.
        fake.requestOverride = {
            ok: true,
            authority: 'A-REPEATED',
            payUrl: 'https://gateway.test/pay/repeat'
        };
        expect(await buy(10)).toBe(200);
        expect(await buy(10)).toBe(502);
        expect(store.availableFor(10)).toBe(1);
    });

    it('throttles checkout, because each attempt costs money downstream', async () => {
        store.addCodes(10, uuids(20));
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 9; attempt += 1) {
            statuses.push(await buy(10));
        }
        // Eight get through the window; the ninth is refused with the header that tells a
        // well-behaved client when to come back.
        expect(statuses.filter((status) => status === 200)).toHaveLength(8);
        const refused = await post('/api/pay/start', { amount: 10, phone: '09170459330' });
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).not.toBeNull();
        // A refused request must not have taken stock with it.
        expect(store.availableFor(10)).toBe(12);
    });

    it('never sells one code to two buyers', async () => {
        store.addCodes(10, uuids(1));
        const [first, second] = await Promise.all([buy(10), buy(10)]);
        expect([first, second].toSorted((a, b) => a - b)).toEqual([200, 409]);
    });
});

describe('the callback', () => {
    /** Stocks one code and buys it, leaving an order the gateway would call back about. */
    async function pending(
        amount: 5 | 10 | 25 = 10
    ): Promise<{ authority: string; token: string }> {
        store.addCodes(amount, uuids(1));
        await buy(amount);
        return lastOrder();
    }

    it('verifies with OUR stored amount, never one from the request', async () => {
        const { authority } = await pending(5);
        // The query string carries a bigger number. If it reached verify, a 350,000 Toman
        // payment would settle a 1,750,000 Toman card.
        await get(`/api/pay/callback?Authority=${authority}&Status=OK&amount=1750000`);
        expect(fake.verifyCalls).toEqual([{ authority, toman: PRICES[5] }]);
    });

    it('delivers the code and SMSes it once the payment verifies', async () => {
        const { authority, token } = await pending();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
            code: string | null;
            refId: number | null;
            smsDelivered: boolean;
            phone: string;
        };
        expect(receipt.outcome).toBe('paid');
        expect(receipt.code).toMatch(/^[0-9a-f-]{36}$/);
        expect(receipt.refId).toBe(987654);
        expect(receipt.smsDelivered).toBe(true);
        // The buyer sees the number in the form they typed it, not the stored E.164 form.
        expect(receipt.phone).toBe('09170459330');
        expect(fake.smsSent).toEqual([{ phone: '+989170459330', code: receipt.code }]);
    });

    it('returns the SAME code on a replayed callback and never takes a second from stock', async () => {
        store.addCodes(10, uuids(5));
        await buy(10);
        const { authority, token } = lastOrder();

        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        const first = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            code: string;
        };

        // Zarinpal answers 101 on every repeat verify, which is exactly what a refresh
        // produces. It means "already paid", not "pay again".
        fake.verifyResult = { ok: true, refId: 987654, alreadyVerified: true };
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        const again = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            code: string;
        };

        expect(again.code).toBe(first.code);
        expect(store.stock().find((line) => line.amount === 10)?.sold).toBe(1);
        expect(fake.smsSent).toHaveLength(1);
    });

    it('turns away a callback for an authority it does not know', async () => {
        const response = await get('/api/pay/callback?Authority=FORGED&Status=OK');
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/?pay=unknown');
        expect(fake.verifyCalls).toHaveLength(0);
    });

    it('does not pay out when the gateway refuses to verify, even with Status=OK', async () => {
        const { authority, token } = await pending();
        // Status=OK is a string anyone can type into an address bar. Only verify decides.
        fake.verifyResult = { ok: false, reason: 'verify failed (code -51)' };
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
            code: string | null;
        };
        expect(receipt.outcome).toBe('failed');
        expect(receipt.code).toBeNull();
        expect(fake.smsSent).toHaveLength(0);
        // The code goes back on the shelf.
        expect(store.availableFor(10)).toBe(1);
    });

    it('cannot be told a verified payment was cancelled', async () => {
        const { authority, token } = await pending();
        // A forged Status=NOK would otherwise be a free way to cancel a stranger's order
        // and release their code. Status never decides; verify does.
        await get(`/api/pay/callback?Authority=${authority}&Status=NOK`);

        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
            code: string | null;
        };
        expect(receipt.outcome).toBe('paid');
        expect(receipt.code).not.toBeNull();
    });

    it('calls a genuine cancellation what it is', async () => {
        const { authority, token } = await pending();
        fake.verifyResult = { ok: false, reason: 'verify failed (code -51)' };
        await get(`/api/pay/callback?Authority=${authority}&Status=NOK`);

        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
        };
        // Not "failed": the buyer chose to stop, and telling them their payment failed
        // would be both wrong and alarming.
        expect(receipt.outcome).toBe('cancelled');
    });

    it('keeps the code when the SMS does not go out', async () => {
        const { authority, token } = await pending();
        fake.smsResult = { ok: false, reason: 'SMS account is out of credit' };
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
            code: string | null;
            smsDelivered: boolean;
        };
        // The payment succeeded. A provider outage is a notice, never a failed purchase.
        expect(receipt.outcome).toBe('paid');
        expect(receipt.code).not.toBeNull();
        expect(receipt.smsDelivered).toBe(false);
    });

    it('records a verified payment it cannot fulfil rather than calling it a failure', async () => {
        const { authority, token } = await pending();
        // The hold lapsed and the last code went to someone else before this payment
        // landed. The money is real, so the order is PAID - with no code. Calling it a
        // failure would be a lie about money that has moved, and the buyer would stop
        // chasing a refund they are owed.
        store.settleUnpaid(store.recentOrders(1)[0].id, 'failed');
        store.addCodes(10, []);
        const remaining = store.availableFor(10);
        for (let index = 0; index < remaining; index += 1) {
            store.startOrder(
                {
                    id: `drain-${index}`,
                    amount: 10,
                    toman: PRICES[10],
                    phone: '+989170459330',
                    createdAt: new Date().toISOString()
                },
                60_000
            );
        }

        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        const receipt = (await (await get(`/api/pay/receipt?token=${token}`)).json()) as {
            outcome: string;
            code: string | null;
            refId: number | null;
        };
        expect(receipt.outcome).toBe('paid');
        expect(receipt.code).toBeNull();
        // The reference is what support needs to find them, so it must be there.
        expect(receipt.refId).toBe(987654);
        expect(fake.smsSent).toHaveLength(0);

        const cookie = await post('/api/admin/session', { key: ADMIN_KEY }).then(
            (response) => (response.headers.get('set-cookie') ?? '').split(';')[0]
        );
        const overview = (await (await get('/api/admin/overview', { cookie })).json()) as {
            owed: number;
        };
        expect(overview.owed).toBe(1);
    });

    it('says nothing about an order that has not settled', async () => {
        const { token } = await pending();
        expect((await get(`/api/pay/receipt?token=${token}`)).status).toBe(404);
    });

    it('says nothing about a guessed token', async () => {
        expect((await get('/api/pay/receipt?token=NOTATOKEN')).status).toBe(404);
    });
});

describe('the console', () => {
    /** Signs in and returns the cookie header a browser would send back. */
    async function signIn(key = ADMIN_KEY): Promise<string> {
        const response = await post('/api/admin/session', { key });
        expect(response.status).toBe(204);
        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Strict');
        return setCookie.split(';')[0];
    }

    it('refuses every admin route without a session', async () => {
        expect((await get('/api/admin/overview')).status).toBe(401);
        expect((await post('/api/admin/codes', { amount: 5, codes: uuids(1) })).status).toBe(401);
    });

    it('refuses a wrong key and says nothing useful about it', async () => {
        const response = await post('/api/admin/session', { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
        expect(response.status).toBe(401);
        expect(response.headers.get('set-cookie')).toBeNull();
        // The response must not confirm any part of the real key.
        expect(await response.text()).not.toContain('ABCD');
    });

    it('locks out after repeated wrong keys', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect((await post('/api/admin/session', { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' })).status).toBe(
                401
            );
        }
        const locked = await post('/api/admin/session', { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
        expect(locked.status).toBe(429);
        expect(locked.headers.get('retry-after')).not.toBeNull();
    });

    it('adds codes, reports duplicates, and hands back what it could not read', async () => {
        const cookie = await signIn();
        const good = uuids(2);
        const response = await post(
            '/api/admin/codes',
            { amount: 10, codes: [...good, good[0], 'NOT-A-UUID', ''] },
            { cookie }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ added: 2, duplicate: 1, invalid: ['NOT-A-UUID'] });
        expect(store.availableFor(10)).toBe(2);
    });

    it('shows stock and the count that needs a human', async () => {
        const cookie = await signIn();
        store.addCodes(10, uuids(1));
        await buy(10, '+989170459330');
        const { authority } = lastOrder();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        const overview = (await (await get('/api/admin/overview', { cookie })).json()) as {
            stock: Array<{ amount: number; sold: number }>;
            owed: number;
        };

        expect(overview.stock.find((line) => line.amount === 10)?.sold).toBe(1);
        expect(overview.owed).toBe(0);
    });

    it('lists the ledger with the buyer, the money and the code', async () => {
        const cookie = await signIn();
        store.addCodes(10, uuids(1));
        await buy(10, '+989170459330');
        const { authority } = lastOrder();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        const page = (await (await get('/api/admin/orders', { cookie })).json()) as {
            rows: Array<{ phone: string; status: string; code: string | null }>;
            total: number;
            page: number;
        };

        expect(page.total).toBe(1);
        expect(page.page).toBe(1);
        expect(page.rows[0].status).toBe('paid');
        // Typed as +98, shown back to the operator the way an Iranian reads it.
        expect(page.rows[0].phone).toBe('09170459330');
        expect(page.rows[0].code).not.toBeNull();
    });

    it('finds an order by any of the things a support call starts with', async () => {
        const cookie = await signIn();
        store.addCodes(5, uuids(1));
        await buy(5, '09121234567');
        const { authority } = lastOrder();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        const code = store.recentOrders(1)[0].code ?? '';

        const search = async (term: string): Promise<number> => {
            const found = (await (
                await get(`/api/admin/orders?search=${encodeURIComponent(term)}`, { cookie })
            ).json()) as { total: number };
            return found.total;
        };

        // The number as typed, without its trunk zero, in international form, and as a
        // fragment - one stored value, four ways a person writes it.
        expect(await search('09121234567')).toBe(1);
        expect(await search('9121234567')).toBe(1);
        expect(await search('+989121234567')).toBe(1);
        expect(await search('912123')).toBe(1);
        // The delivered code and the bank reference.
        expect(await search(code)).toBe(1);
        expect(await search('987654')).toBe(1);
        // And a term that matches nothing must match NOTHING - not everything.
        expect(await search('09350000000')).toBe(0);
    });

    it('pages the ledger without losing or repeating a row', async () => {
        const cookie = await signIn();
        store.addCodes(5, uuids(30));
        // Straight into the store: 30 checkouts through the HTTP route would trip the
        // purchase throttle, which is a different test's subject.
        for (let index = 0; index < 30; index += 1) {
            store.startOrder(
                {
                    id: `order-${String(index).padStart(3, '0')}`,
                    amount: 5,
                    toman: PRICES[5],
                    phone: '+989170459330',
                    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
                },
                60_000
            );
        }

        const first = (await (await get('/api/admin/orders?page=1', { cookie })).json()) as {
            rows: Array<{ id: string }>;
            total: number;
            pageSize: number;
        };
        const second = (await (await get('/api/admin/orders?page=2', { cookie })).json()) as {
            rows: Array<{ id: string }>;
        };

        expect(first.total).toBe(30);
        expect(first.rows).toHaveLength(first.pageSize);
        expect(second.rows).toHaveLength(30 - first.pageSize);
        const ids = new Set([...first.rows, ...second.rows].map((row) => row.id));
        expect(ids.size).toBe(30);
    });

    it('shows every code and where it went', async () => {
        const cookie = await signIn();
        const loaded = uuids(3);
        store.addCodes(10, loaded);
        await buy(10, '09121234567');
        const { authority } = lastOrder();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);
        // A second checkout that has not settled: its code is HELD, not sold.
        await buy(10, '09355556677');

        const all = (await (await get('/api/admin/codes', { cookie })).json()) as {
            rows: Array<{ code: string; state: string; phone: string | null }>;
            total: number;
        };
        expect(all.total).toBe(3);
        expect(all.rows.map((row) => row.state).toSorted()).toEqual(['free', 'held', 'sold']);
        expect(all.rows.every((row) => loaded.includes(row.code))).toBe(true);

        // The sold one names its buyer; the others have nobody.
        const sold = all.rows.find((row) => row.state === 'sold');
        expect(sold?.phone).toBe('09121234567');
        expect(all.rows.find((row) => row.state === 'free')?.phone).toBeNull();

        // Filters narrow it the way the console's chips do.
        const free = (await (await get('/api/admin/codes?state=free', { cookie })).json()) as {
            total: number;
        };
        expect(free.total).toBe(1);
        const wrongTier = (await (await get('/api/admin/codes?amount=25', { cookie })).json()) as {
            total: number;
        };
        expect(wrongTier.total).toBe(0);

        // And a code is findable by the buyer's number or by part of the code itself.
        const byPhone = (await (
            await get('/api/admin/codes?search=912123', { cookie })
        ).json()) as { rows: Array<{ code: string }> };
        expect(byPhone.rows).toHaveLength(1);
        expect(byPhone.rows[0].code).toBe(sold?.code);
        const byCode = (await (
            await get(`/api/admin/codes?search=${loaded[0].slice(0, 8)}`, { cookie })
        ).json()) as { total: number };
        expect(byCode.total).toBe(1);
    });

    it('keeps the code list behind the session like everything else', async () => {
        expect((await get('/api/admin/codes')).status).toBe(401);
    });

    it('signs out for good', async () => {
        const cookie = await signIn();
        expect((await get('/api/admin/overview', { cookie })).status).toBe(200);

        const out = await send('DELETE', '/api/admin/session', undefined, { cookie });
        expect(out.status).toBe(204);
        // The same cookie value must not work again - the session is gone server-side,
        // not merely cleared in the browser.
        expect((await get('/api/admin/overview', { cookie })).status).toBe(401);
    });
});

describe('the catalogue', () => {
    async function signedIn(): Promise<string> {
        const response = await post('/api/admin/session', { key: ADMIN_KEY });
        return (response.headers.get('set-cookie') ?? '').split(';')[0];
    }

    it('adds a denomination that did not exist before', async () => {
        const cookie = await signedIn();
        const created = await post(
            '/api/admin/tiers',
            {
                amount: 50,
                toman: 3_500_000,
                title: 'کارت پنجاه دلاری',
                blurb: 'برای خرید بزرگ.',
                recommended: false,
                active: true,
                sort: 40
            },
            { cookie }
        );

        expect(created.status).toBe(200);
        store.addCodes(50, uuids(1));
        // A denomination the code did not know about at compile time is immediately buyable.
        expect(await buy(50)).toBe(200);
    });

    it('keeps at most one recommended card', async () => {
        const cookie = await signedIn();
        const body = (await (
            await post(
                '/api/admin/tiers',
                {
                    amount: 5,
                    toman: PRICES[5],
                    title: 'کارت پنج دلاری',
                    blurb: 'x',
                    recommended: true,
                    active: true,
                    sort: 10
                },
                { cookie }
            )
        ).json()) as { tiers: Array<{ amount: number; recommended: boolean }> };

        // The treatment means "most people pick this". Two of them means nothing.
        expect(body.tiers.filter((tier) => tier.recommended)).toHaveLength(1);
        expect(body.tiers.find((tier) => tier.recommended)?.amount).toBe(5);
    });

    it('deactivates rather than deletes a tier that has been sold', async () => {
        const cookie = await signedIn();
        store.addCodes(10, uuids(1));
        await buy(10);
        const { authority } = lastOrder();
        await get(`/api/pay/callback?Authority=${authority}&Status=OK`);

        // The amount rides in the query string, not a DELETE body: a body on DELETE has no
        // defined semantics and intermediaries may drop it.
        const removed = await send('DELETE', '/api/admin/tiers?amount=10', undefined, { cookie });

        // Dropping the row would orphan the history that explains what someone paid.
        expect(await removed.json()).toEqual({ outcome: 'deactivated' });
        expect(store.tiers().find((tier) => tier.amount === 10)?.active).toBe(false);
        expect(store.recentOrders(1)[0].amount).toBe(10);
    });

    it('deletes a tier nobody ever used', async () => {
        const cookie = await signedIn();
        const removed = await send('DELETE', '/api/admin/tiers?amount=25', undefined, { cookie });
        expect(await removed.json()).toEqual({ outcome: 'deleted' });
        expect(store.tiers().map((tier) => tier.amount)).toEqual([5, 10]);
    });
});

describe('runtime settings', () => {
    async function signedIn(): Promise<string> {
        const response = await post('/api/admin/session', { key: ADMIN_KEY });
        return (response.headers.get('set-cookie') ?? '').split(';')[0];
    }

    it('never sends a secret back, only its last four characters', async () => {
        const cookie = await signedIn();
        await post(
            '/api/admin/settings',
            { merchantId: 'abcdefgh-1234-5678-9012-ffff00005555' },
            { cookie }
        );

        const raw = await (await get('/api/admin/settings', { cookie })).text();
        expect(raw).toContain('••••5555');
        // A stolen session can overwrite a credential; it must not be able to read one out.
        expect(raw).not.toContain('abcdefgh-1234-5678-9012-ffff00005555');
        expect((JSON.parse(raw) as { merchantIdSet: boolean }).merchantIdSet).toBe(true);
    });

    it('treats an absent field as unchanged and an empty one as cleared', async () => {
        const cookie = await signedIn();
        await post(
            '/api/admin/settings',
            { merchantId: 'first-merchant-0000-0000-000012349999' },
            { cookie }
        );

        // Saving a template name must not wipe a working credential just because its input
        // was left blank on screen.
        await post('/api/admin/settings', { kavenegarTemplate: 'renamed' }, { cookie });
        expect(settings.current().merchantId).toBe('first-merchant-0000-0000-000012349999');
        expect(settings.current().kavenegarTemplate).toBe('renamed');

        // An explicit empty string IS a clear, and it does not fall back to the seed.
        await post('/api/admin/settings', { merchantId: '' }, { cookie });
        expect(settings.current().merchantId).toBe('');
    });

    it('takes effect on the next payment without a restart', async () => {
        const cookie = await signedIn();
        await post(
            '/api/admin/settings',
            { zarinpalBase: 'https://sandbox.zarinpal.com' },
            { cookie }
        );
        const view = (await (await get('/api/admin/settings', { cookie })).json()) as {
            sandbox: boolean;
        };
        expect(view.sandbox).toBe(true);
        expect(settings.current().zarinpalBase).toBe('https://sandbox.zarinpal.com');
    });

    it('records what changed, masked', async () => {
        const cookie = await signedIn();
        await post(
            '/api/admin/settings',
            { merchantId: 'aaaaaaaa-bbbb-cccc-dddd-eeee00007777' },
            { cookie }
        );

        const log = await (await get('/api/admin/settings/log', { cookie })).text();
        expect(log).toContain('merchantId');
        expect(log).toContain('••••7777');
        // The audit is not a way around write-only.
        expect(log).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeee00007777');
    });

    it('mints a console credential on a fresh install rather than shipping a default', () => {
        // A default in a public repository is a published credential. A fresh database with
        // no ADMIN_KEY set gets one minted, in the published shape, and only its hash stored.
        const bare = createStore(':memory:');
        const fresh = createSettings({ store: bare, adminKey: '' });

        const minted = fresh.ensureAdminKey();
        expect(minted).toMatch(
            /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/
        );
        expect(fresh.matchesAdminKey(minted ?? '')).toBe(true);
        expect(bare.getSetting('adminKeyHash') ?? '').not.toContain(minted ?? 'x');

        // It happens ONCE: a restart must not silently replace a working credential.
        expect(fresh.ensureAdminKey()).toBeNull();
        bare.close();
    });

    it('does not mint over an environment key', () => {
        const bare = createStore(':memory:');
        const fresh = createSettings({ store: bare, adminKey: ADMIN_KEY });
        expect(fresh.ensureAdminKey()).toBeNull();
        expect(fresh.matchesAdminKey(ADMIN_KEY)).toBe(true);
        bare.close();
    });

    it('keeps every admin route behind the session', async () => {
        expect((await get('/api/admin/tiers')).status).toBe(401);
        expect((await get('/api/admin/settings')).status).toBe(401);
        expect((await get('/api/admin/settings/log')).status).toBe(401);
        expect(
            (await post('/api/admin/key', { currentKey: ADMIN_KEY, newKey: 'ABCD-ABCD-ABCD-ABCD' }))
                .status
        ).toBe(401);
        expect((await post('/api/admin/test-sms', { phone: '09170459330' })).status).toBe(401);
    });
});

describe('rotating the admin key', () => {
    const NEW_KEY = 'MNPQ-RSTU-VWXY-2345';

    async function signedIn(key = ADMIN_KEY): Promise<string> {
        const response = await post('/api/admin/session', { key });
        expect(response.status).toBe(204);
        return (response.headers.get('set-cookie') ?? '').split(';')[0];
    }

    it('accepts the environment key until one is rotated in', async () => {
        expect(settings.matchesAdminKey(ADMIN_KEY)).toBe(true);
        await signedIn();
    });

    it('demands the CURRENT key even from an open session', async () => {
        const cookie = await signedIn();
        // A session proves someone was the admin at sign-in. Replacing the credential should
        // prove they still are.
        const refused = await post(
            '/api/admin/key',
            { currentKey: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newKey: NEW_KEY },
            { cookie }
        );
        expect(refused.status).toBe(401);
        expect(settings.matchesAdminKey(ADMIN_KEY)).toBe(true);
    });

    it('refuses a new key that is not the published shape', async () => {
        const cookie = await signedIn();
        expect(
            (await post('/api/admin/key', { currentKey: ADMIN_KEY, newKey: 'short' }, { cookie }))
                .status
        ).toBe(409);
    });

    it('replaces the key, kills every session, and stores only a hash', async () => {
        const cookie = await signedIn();
        expect(
            (await post('/api/admin/key', { currentKey: ADMIN_KEY, newKey: NEW_KEY }, { cookie }))
                .status
        ).toBe(204);

        // The old key is gone, the new one works.
        expect(settings.matchesAdminKey(ADMIN_KEY)).toBe(false);
        expect(settings.matchesAdminKey(NEW_KEY)).toBe(true);

        // A rotation that leaves the previous holder signed in has rotated nothing.
        expect((await get('/api/admin/overview', { cookie })).status).toBe(401);

        // A leaked database yields a hash, never a usable key.
        expect(store.getSetting('adminKeyHash') ?? '').not.toContain(NEW_KEY);
        await signedIn(NEW_KEY);
    });
});

describe('the shop name', () => {
    async function signedIn(): Promise<string> {
        const response = await post('/api/admin/session', { key: ADMIN_KEY });
        return (response.headers.get('set-cookie') ?? '').split(';')[0];
    }

    it('is public, because it is the brand on every page', async () => {
        const cookie = await signedIn();
        await post('/api/admin/settings', { appName: 'فروشگاه تازه' }, { cookie });

        const body = (await (await get('/api/pay/catalog')).json()) as { appName: string };
        expect(body.appName).toBe('فروشگاه تازه');
    });

    it('reaches the gateway as the payment description', async () => {
        const cookie = await signedIn();
        await post('/api/admin/settings', { appName: 'برند تازه' }, { cookie });
        store.addCodes(10, uuids(1));

        // The description is what the buyer sees on the bank's own page, so a rename that
        // stopped at the shop would leave them paying "نورا چین" for something else.
        expect(await buy(10)).toBe(200);
        expect(fake.descriptions.at(-1)).toContain('برند تازه');
    });
});
