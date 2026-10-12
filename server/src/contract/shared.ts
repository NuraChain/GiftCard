// The shapes more than one feature's contract needs. Everything else lives with the feature
// that owns it - see each features/*/contract.ts.
import { z } from 'zod';

/**
 * One proxy the bot reaches Telegram through: an ordinary HTTP proxy, asked to open a tunnel
 * (CONNECT) to the API host.
 *
 * `protocol` IS HOW THE PROXY ITSELF IS SPOKEN TO, not what goes through it. What goes through
 * is always the same TLS connection to Telegram, which the proxy carries and cannot read - so
 * it never sees the bot token, whichever of the two this is. `https` adds TLS between this
 * machine and the proxy as well, which hides the proxy's own password, and the fact that the
 * tunnel is to Telegram, from the network in between.
 *
 * THE PASSWORD IS WRITE-ONLY, like every other credential the console holds. A blank one means
 * "the one already stored for this address" - see `keepPasswords`.
 */
export const telegramProxy = z.object({
    protocol: z.enum(['http', 'https']),
    server: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^[a-z0-9.:-]+$/i, 'Proxy server must be a host name or an IP address'),
    port: z.number().int().min(1).max(65_535),
    username: z
        .string()
        .trim()
        .max(200)
        // It is what separates the name from the password on the wire.
        .regex(/^[^:]*$/, 'Proxy username cannot contain a colon'),
    password: z.string().max(200)
});

/** Tried in the order entered. */
export const telegramProxyList = z.array(telegramProxy).max(20);

export type TelegramProxy = z.infer<typeof telegramProxy>;

/**
 * Where a proxy is, written the way one is handed around - and what tells two of them apart.
 * Everything but the password.
 */
export function proxyAddress(proxy: Omit<TelegramProxy, 'password'>): string {
    const login = proxy.username === '' ? '' : `${proxy.username}@`;
    // An IPv6 address is full of colons, and a URL needs to know which one starts the port.
    const host = proxy.server.includes(':') ? `[${proxy.server}]` : proxy.server;
    return `${proxy.protocol}://${login}${host}:${proxy.port}`;
}

/**
 * The list as it is STORED: every blank password filled in from the proxy already stored at
 * the same address.
 *
 * BY ADDRESS, NOT BY POSITION. A password kept for "the second row" would follow that row to
 * whatever server it was edited to point at - and the console could then be used to send a
 * stored password to a machine of somebody's choosing. Change the address and the password
 * has to be typed again.
 */
export function keepPasswords(next: TelegramProxy[], stored: TelegramProxy[]): TelegramProxy[] {
    return next.map((proxy) => {
        if (proxy.username === '') {
            // Nobody to sign in as, so nothing to sign in with.
            return { ...proxy, password: '' };
        }
        if (proxy.password !== '') {
            return proxy;
        }
        const kept = stored.find((old) => proxyAddress(old) === proxyAddress(proxy));
        return { ...proxy, password: kept?.password ?? '' };
    });
}

/**
 * A proxy read out of the address it is usually handed around as -
 * `https://user:pass@host:8443`, or a bare `host:port`, which is taken for plain http - or
 * null when the text is not one. Any other kind of proxy is not one: the bot can only use
 * these two.
 */
export function parseProxyUrl(text: string): TelegramProxy | null {
    const trimmed = text.trim();
    try {
        const url = new URL(
            /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
        );
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        const parsed = telegramProxy.safeParse({
            protocol: url.protocol.slice(0, -1),
            server: url.hostname.replace(/^\[|\]$/g, ''),
            // A URL drops the port when it is the one its scheme implies.
            port: Number(url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : url.port),
            // Both are percent-encoded in a URL, and neither is on the wire to the proxy.
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password)
        });
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * A denomination, in dollars. This USED to be `union([literal(5), literal(10), literal(25)])`,
 * which made "an unlisted amount is a forged request" a compile-time and wire-time fact.
 *
 * The catalogue is editable now, so the valid set is a database table and the schema can only
 * check the shape. THE RULE DID NOT GO AWAY WITH THE TYPE: `pay.start` looks the amount up in
 * the live tier table and refuses anything missing or inactive, before a code is claimed or a
 * gateway is called. Read that handler alongside this line - it is where the union went.
 */
export const amountField: z.ZodType<number> = z.number().int().min(1).max(100_000);

/** The same field arriving through a query string, where everything is text. */
export const amountQueryField: z.ZodType<number> = z.coerce.number().int().min(1).max(100_000);
