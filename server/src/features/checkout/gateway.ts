// Which gateway a payment goes TO, and - separately - which one it came back FROM.
//
// THE TWO ARE DIFFERENT QUESTIONS, and this file exists to keep them apart. A new payment goes
// to whichever gateway the console has selected at that moment. A payment coming BACK is
// verified by the gateway that opened it, however long ago that was and whatever the console
// says today - the buyer who left for Zarinpal's page a minute before the operator switched to
// Zibal is still going to return from Zarinpal, with money that is still real.
//
// THE ORDER REMEMBERS; THE REQUEST IS NOT ASKED. The handle stored on an order says which
// gateway issued it: Zibal's are stored as `zibal:<trackId>`, Zarinpal's exactly as issued -
// which is what every order written before this file existed already holds, so there was
// nothing to migrate.
//
// Routing on the SHAPE of the return instead would hand the choice of verifier to whoever
// typed the URL. Present a Zibal payment's number under Zarinpal's parameter names and it is
// checked against a gateway that has never heard of it, fails, and takes a paid order's code
// back to the shelf - precisely the forged cancellation rule 1 in ./checkout.ts exists to stop.
// Here a mislabelled return either finds no order at all, or finds the right one and is
// verified by the gateway recorded on it.
import type { GatewayName } from '../settings/contract.ts';
import type { PaymentGateway } from './zarinpal.ts';

/** @internal What marks a stored handle as Zibal's. A Zarinpal authority never contains a colon. */
const ZIBAL_PREFIX = 'zibal:';

export interface GatewaySwitchOptions {
    /**
     * Read PER PAYMENT, not captured once: the choice is a console setting, and a switch built
     * from a literal at boot would keep sending buyers to the old gateway until a restart.
     */
    active: () => GatewayName;

    zarinpal: PaymentGateway;
    zibal: PaymentGateway;
}

/**
 * One `PaymentGateway` in front of two. The app is handed this and never learns there is more
 * than one - which is what keeps the four rules in ./checkout.ts written exactly once.
 */
export function createGatewaySwitch(options: GatewaySwitchOptions): PaymentGateway {
    return {
        async request(input) {
            if (options.active() !== 'zibal') {
                return options.zarinpal.request(input);
            }
            const opened = await options.zibal.request(input);
            return opened.ok
                ? { ...opened, authority: `${ZIBAL_PREFIX}${opened.authority}` }
                : opened;
        },

        verify(authority, tomanAmount) {
            return authority.startsWith(ZIBAL_PREFIX)
                ? options.zibal.verify(authority.slice(ZIBAL_PREFIX.length), tomanAmount)
                : options.zarinpal.verify(authority, tomanAmount);
        }
    };
}

/** What a gateway's return says, in the one form the callback route needs. */
export interface GatewayReturn {
    /** The handle to look the order up by, in its STORED form. */
    authority: string;

    /**
     * Whether the gateway called it a success. It decides the wording of a failure and nothing
     * else - it is a string anyone can type.
     */
    saidOk: boolean;
}

/**
 * Reads the query string a gateway sent the buyer back with, or null when it carries neither
 * gateway's handle.
 *
 * Zibal returns `?trackId=..&success=1|0&status=..`; Zarinpal returns `?Authority=..&Status=OK|NOK`.
 * Every value is checked to be a string before it is used: the parser hands back an ARRAY for
 * a repeated parameter, and this query is written by a stranger.
 */
export function readReturn(query: Record<string, unknown>): GatewayReturn | null {
    const { trackId, Authority: authority } = query;
    if (typeof trackId === 'string' && trackId !== '') {
        return { authority: `${ZIBAL_PREFIX}${trackId}`, saidOk: query.success === '1' };
    }
    if (typeof authority === 'string' && authority !== '') {
        return { authority, saidOk: query.Status === 'OK' };
    }
    return null;
}
