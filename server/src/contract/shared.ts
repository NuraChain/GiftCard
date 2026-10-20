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
 * "the one already stored for this address" - see `keepPasswords`. It is sent to the proxy
 * whenever there is one, with a username or without.
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
        // A password that was typed is the password, with a username beside it or without.
        if (proxy.password !== '') {
            return proxy;
        }
        const kept = stored.find((old) => proxyAddress(old) === proxyAddress(proxy));
        return { ...proxy, password: kept?.password ?? '' };
    });
}

/** @internal Percent-decoded when it decodes, and as it was typed when it does not. */
function unescaped(part: string): string {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
}

/**
 * A proxy read out of the text it is usually handed around as, or null when the text is not
 * one. Any other kind of proxy is not one: the bot can only use these two.
 *
 * TWO WAYS OF WRITING ONE ARE READ. An address, `https://user:pass@host:8443`, where no scheme
 * is taken for plain http and no port for the one the scheme implies. And the line a seller's
 * list has, `host:port:user:pass`.
 *
 * SPLIT BY HAND, NOT BY `new URL`. A password is pasted as it is, not percent-encoded, and a
 * `/` or a `#` in one makes a URL parser end the host early: it then reads a different server
 * out of the same text and drops the login without a word. The login here is everything up to
 * the LAST `@`, whatever is in it.
 */
export function parseProxyUrl(text: string): TelegramProxy | null {
    const trimmed = text.trim();
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
    const protocol = scheme === null ? 'http' : scheme[1].toLowerCase();
    const rest = scheme === null ? trimmed : trimmed.slice(scheme[0].length);

    // The seller's line. Not looked for in an address that has its login in front of an `@`,
    // where a password of `8080:a:b` would otherwise be read as one.
    const line =
        scheme === null || !rest.includes('@')
            ? /^([a-z0-9.-]+):(\d+):([^:]*):(.*)$/i.exec(rest)
            : null;
    if (line !== null) {
        const [, server, port, username, password] = line;
        return checked({ protocol, server, port: Number(port), username, password });
    }

    const at = rest.lastIndexOf('@');
    const [username = '', ...password] = at === -1 ? [] : rest.slice(0, at).split(':');
    const place = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d+))?$/i.exec(
        // An address may end in a `/`, and nothing after one says where the proxy is.
        rest.slice(at + 1).replace(/[/?#].*$/, '')
    );
    if (place === null) {
        return null;
    }
    return checked({
        protocol,
        server: place[1].replace(/^\[|\]$/g, ''),
        port: Number(place[2] ?? (protocol === 'https' ? 443 : 80)),
        username: unescaped(username),
        password: unescaped(password.join(':'))
    });
}

/** @internal What was read, if it is a proxy: this is where a `socks5://` one stops. */
function checked(read: Record<keyof TelegramProxy, unknown>): TelegramProxy | null {
    const parsed = telegramProxy.safeParse(read);
    // A host name means the same in either case, and one proxy must not become two rows.
    return parsed.success ? { ...parsed.data, server: parsed.data.server.toLowerCase() } : null;
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
