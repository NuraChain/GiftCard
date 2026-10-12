// The shapes more than one feature's contract needs. Everything else lives with the feature
// that owns it - see each features/*/contract.ts.
import { z } from 'zod';

/**
 * @internal The bytes of a proxy secret, or null when it is not one.
 *
 * A secret is hex or base64, and what it decodes to decides which proxy it is: 16 bytes is a
 * plain one, `dd` plus 16 is the padded kind, and `ee` plus 16 plus a domain is fake-TLS - the
 * kind almost every shared link is. Anything else is a paste that lost a character, and it is
 * refused here rather than saved and left to fail at three in the morning.
 */
function secretBytes(secret: string): number[] | null {
    let bytes: number[];
    if (/^[0-9a-f]+$/i.test(secret)) {
        if (secret.length % 2 !== 0) {
            return null;
        }
        bytes = (secret.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
    } else {
        try {
            const plain = atob(secret.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''));
            bytes = [...plain].map((char) => char.charCodeAt(0));
        } catch {
            return null;
        }
    }
    const [kind] = bytes;
    const known =
        bytes.length === 16 ||
        (bytes.length === 17 && kind === 0xdd) ||
        (bytes.length >= 18 && kind === 0xee);
    return known ? bytes : null;
}

/**
 * One MTProto proxy: the three things a `tg://proxy` link carries.
 *
 * MTPROTO AND NOTHING ELSE. An HTTP relay has to be handed the bot token to do its job; this
 * kind is handed traffic it cannot read. That is why the list takes no other type.
 */
export const telegramProxy = z.object({
    server: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^[a-z0-9.:-]+$/i, 'Proxy server must be a host name or an IP address'),
    port: z.number().int().min(1).max(65_535),
    secret: z
        .string()
        .trim()
        .max(600)
        .refine((secret) => secretBytes(secret) !== null, 'Proxy secret is not valid')
});

/** Tried in the order entered. */
export const telegramProxyList = z.array(telegramProxy).max(20);

export type TelegramProxy = z.infer<typeof telegramProxy>;

/**
 * A proxy read out of the link Telegram itself shares - `tg://proxy?server=…&port=…&secret=…`
 * or its `https://t.me/proxy?…` twin - or null when the text is not one.
 */
export function parseProxyLink(text: string): TelegramProxy | null {
    let link: URL;
    try {
        link = new URL(text.trim());
    } catch {
        return null;
    }
    const shared =
        (link.protocol === 'tg:' && link.hostname === 'proxy') ||
        (/^https?:$/.test(link.protocol) &&
            /^(t|telegram)\.me$/.test(link.hostname) &&
            link.pathname === '/proxy');
    if (!shared) {
        return null;
    }
    const parsed = telegramProxy.safeParse({
        server: link.searchParams.get('server') ?? '',
        port: Number(link.searchParams.get('port')),
        // A query string turns `+` into a space, and base64 is allowed to contain one.
        secret: (link.searchParams.get('secret') ?? '').replace(/ /g, '+')
    });
    return parsed.success ? parsed.data : null;
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
