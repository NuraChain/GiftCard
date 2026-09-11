// Crypto wallet addresses: what shape they take, and whether one is real.
//
// THIS IS WHERE A PAYOUT IS SAVED OR LOST. A gift code redeemed to a mistyped address is an
// irreversible transfer to nobody - there is no chargeback, no support desk and no second
// chance. Everything here exists to make that outcome as hard as possible to reach.
//
// It lives in domain/ because the CONTRACT imports it, and the contract is client-safe by
// construction - so the browser form and the server boundary run this exact rule rather than
// two hand-written regexes that drift. Same arrangement as domain/email.ts, and the same
// split: `walletField` checks the SHAPE (cheap, synchronous, runs at both ends), and
// `checksumOk` proves the address is real (asynchronous, and the handler awaits it before a
// code is consumed).
//
// WHY THE CHECKSUM IS WORTH THE TROUBLE. A shape check accepts `TR7NHq...xyz` with any one
// character wrong; base58check does not, because 4 of its 25 bytes are a hash of the other
// 21. That is the difference between validating that somebody typed 34 characters and
// validating that those 34 characters address a wallet.
//
// TWO NETWORKS, because those are the two USDT actually moves on: TRC20 (Tron) and ERC20
// (Ethereum and every EVM chain that copied its address format). The network is DERIVED from
// the address rather than asked for - the two formats cannot be confused for one another, and
// a dropdown is one more thing for a buyer to get wrong.
import { z } from 'zod';

export type WalletNetwork = 'TRC20' | 'ERC20';

/** An address that passed the shape check, and the network its format belongs to. */
export interface Wallet {
    network: WalletNetwork;

    /**
     * The address, cleaned of invisible characters and nothing else.
     *
     * CASE IS PRESERVED DELIBERATELY, for both networks. Base58 is case-sensitive, so a
     * Tron address lowercased is a different string. And an EVM address typed in mixed case
     * carries an EIP-55 checksum - which this file cannot verify (see `checksumOk`) but the
     * operator's wallet software can, so destroying it here would throw away the one check
     * left standing on that side.
     */
    address: string;
}

/**
 * Characters that carry no glyph and no meaning: zero-width joiners, the byte-order mark, and
 * the bidi isolates an RTL editor sprinkles through anything pasted out of it.
 *
 * A buyer here copies an address out of a Persian chat message, and Telegram hands out bidi
 * marks with the text. They survive the paste, they are INVISIBLE, and one of them turns a
 * correct address into a rejected one with nothing on screen to explain why.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** `T` then 33 base58 characters. Always exactly 34. */
const TRON_SHAPE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** `0x` then 20 bytes of hex, in any case. */
const EVM_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/** Bitcoin's alphabet, which Tron inherited: no 0, O, I or l. */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The longest address either format produces, with room to spare before the regex runs. */
const MAX_LENGTH = 64;

/**
 * The address and its network, or null when it is neither shape.
 *
 * SHAPE ONLY. It says "this could be an address"; `checksumOk` says "this is one". Nothing
 * downstream may treat a non-null return as proof a payout will arrive.
 *
 * Persian digits are NOT rewritten here, and that is a departure from domain/email.ts on
 * purpose: an address is 34 to 42 characters of mixed-case base58 or hex, which nobody types
 * by hand - it is pasted. Rewriting digits could only ever turn one wrong string into a
 * different wrong string, and the checksum is the guard that matters.
 */
export function readWallet(raw: string): Wallet | null {
    const address = raw.replace(INVISIBLE, '').trim();
    if (address.length > MAX_LENGTH) {
        return null;
    }
    if (TRON_SHAPE.test(address)) {
        return { network: 'TRC20', address };
    }
    if (EVM_SHAPE.test(address)) {
        return { network: 'ERC20', address };
    }
    return null;
}

/**
 * Whether the address checks out arithmetically. Await this BEFORE consuming a code.
 *
 * TRC20: full base58check. The last 4 of the 25 decoded bytes are the first 4 bytes of
 * SHA-256(SHA-256(the other 21)), so a single wrong or transposed character fails here with
 * overwhelming probability. This is the check that catches a typo.
 *
 * ERC20: TRUE FOR ANY WELL-SHAPED ADDRESS, and this is a real limit rather than an oversight.
 * An EVM address is 20 raw bytes with no checksum of its own; the optional one (EIP-55) is
 * carried in the LETTER CASE and is verified with keccak-256, which neither Web Crypto nor
 * node:crypto implements - and hand-rolling a hash function inside a payment path to check a
 * checksum that an all-lowercase address does not carry anyway is a worse trade than saying
 * so plainly. `Wallet.address` keeps the case it arrived in so the operator's wallet, which
 * does implement keccak, still runs that check before the transfer leaves.
 *
 * Asynchronous because SHA-256 in a browser is `crypto.subtle`, which is async - and this
 * file has to run in both halves.
 */
export async function checksumOk(wallet: Wallet): Promise<boolean> {
    if (wallet.network === 'ERC20') {
        return true;
    }

    const decoded = base58Decode(wallet.address);
    // 21 bytes of payload, 4 of checksum; 0x41 is Tron's mainnet address prefix, and it is
    // what the leading `T` of every one of these addresses actually encodes.
    if (decoded === null || decoded.length !== 25 || decoded[0] !== 0x41) {
        return false;
    }

    const body = decoded.subarray(0, 21);
    const once = await crypto.subtle.digest('SHA-256', body);
    const twice = new Uint8Array(await crypto.subtle.digest('SHA-256', once));

    // A plain loop, not a timing-safe compare: there is no secret here. The checksum is a
    // function of the public address, so an attacker learns nothing from how long this takes
    // that they could not compute themselves.
    for (let index = 0; index < 4; index += 1) {
        if (decoded[21 + index] !== twice[index]) {
            return false;
        }
    }
    return true;
}

/**
 * @internal Base58 to bytes. Null when a character is outside the alphabet.
 *
 * BigInt rather than a byte-at-a-time carry: the input is 34 characters, so the whole number
 * is 200 bits and the arithmetic is one pass. Leading `1`s are handled separately because
 * they encode leading ZERO bytes, which a numeric decode cannot represent - a Tron address
 * never has one, but a decoder that quietly loses them is a trap for the next caller.
 *
 * The return type names its buffer. A bare `Uint8Array` may be backed by a SharedArrayBuffer
 * as far as the type system knows, and `crypto.subtle.digest` will not take one of those.
 */
function base58Decode(input: string): Uint8Array<ArrayBuffer> | null {
    let value = 0n;
    for (const character of input) {
        const index = BASE58.indexOf(character);
        if (index === -1) {
            return null;
        }
        value = value * 58n + BigInt(index);
    }

    const bytes: number[] = [];
    while (value > 0n) {
        bytes.unshift(Number(value & 0xffn));
        value >>= 8n;
    }
    for (const character of input) {
        if (character !== '1') {
            break;
        }
        bytes.unshift(0);
    }
    return new Uint8Array(bytes);
}

/**
 * The shared field. Like `emailField` it VALIDATES ONLY - it does not clean and it does not
 * run the checksum, so the value reaches a handler in whatever shape it was typed. Every
 * handler therefore runs `readWallet` and then `checksumOk`; nothing downstream may assume an
 * address is spendable just because validation passed.
 *
 * The message is Persian because a form displays it to a buyer.
 */
export const walletField: z.ZodType<string> = z
    .string()
    .trim()
    .max(MAX_LENGTH, { message: 'آدرس کیف پول معتبر نیست' })
    .refine((value) => readWallet(value) !== null, {
        message: 'آدرس کیف پول معتبر نیست. آدرس شبکه TRC20 یا ERC20 را وارد کنید.'
    });
