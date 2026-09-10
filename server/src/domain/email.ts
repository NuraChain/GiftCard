// Email addresses, normalised to ONE canonical form.
//
// This lives in server/src because the contract imports it, and the contract is client-safe
// by construction - so the browser form and the server boundary run this exact rule rather
// than two hand-written regexes that drift. It replaces domain/phone.ts, which did the same
// job for the mobile number the code used to be texted to.
//
// WHAT A PERSIAN KEYBOARD ACTUALLY PRODUCES is the reason this is more than a regex:
//
//   ali۱۲۳@gmail.com    Persian digits in the local part - a Persian layout types these by
//                       default, and rejecting them would be a bug wearing validation's
//                       clothes (the same argument phone.ts made).
//   ali‌@gmail.com       a ZERO-WIDTH NON-JOINER, which Persian typing inserts constantly and
//                       which is INVISIBLE. An address that looks identical to a correct one
//                       and is silently undeliverable is the worst possible failure here,
//                       because the buyer has already paid by the time anyone finds out.
//   ‪ali@gmail.com‬       bidirectional control marks, pasted in from an RTL document.
//
// All three are stripped or converted BEFORE validation.
//
// THE VALIDATION IS DELIBERATELY NOT RFC 5322. The full grammar accepts quoted strings,
// comments and bracketed IP literals, none of which any buyer of a gift card has ever typed,
// and implementing it would reject nothing extra that matters while accepting a great deal
// that is certainly a typo. What is here is the shape a deliverable address takes: something,
// an @, a dotted domain, no spaces.
import { z } from 'zod';

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits, in ASCII order. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Characters that carry no glyph and no meaning in an address: the zero-width non-joiner and
 * joiner, the byte-order mark, and the bidi isolates/overrides an RTL editor sprinkles in.
 * Every one of them survives a copy-paste and none of them is visible.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** The longest address anything sane will accept: 64-character local part, 255-char domain. */
const MAX_LENGTH = 254;

/**
 * Something, an @, a dotted domain. No whitespace anywhere, no second @, and at least one dot
 * in the domain so `ali@localhost` and `ali@gmail` - both of which are usually a half-typed
 * address rather than an intranet host - do not pass.
 */
const SHAPE = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** @internal Rewrites Persian/Arabic-Indic digits to ASCII and drops invisible characters. */
function toAscii(input: string): string {
    let out = '';
    for (const character of input.replace(INVISIBLE, '')) {
        const persian = PERSIAN_DIGITS.indexOf(character);
        const arabic = ARABIC_DIGITS.indexOf(character);
        if (persian !== -1) {
            out += String(persian);
        } else if (arabic !== -1) {
            out += String(arabic);
        } else {
            out += character;
        }
    }
    return out;
}

/**
 * The canonical form: trimmed, cleaned of invisibles, lowercased.
 *
 * LOWERCASING THE WHOLE ADDRESS is a deliberate simplification. The local part is technically
 * case-sensitive per RFC 5321, and in practice no mail provider a buyer here uses treats it
 * so. One stored shape is what makes a lookup by address in the console find the order the
 * buyer is asking about, rather than missing it because they capitalised differently the
 * second time - which is exactly the argument the phone module made for `+989...`.
 *
 * Returns null when the input is not a deliverable-looking address.
 */
export function normalizeEmail(input: string): string | null {
    const cleaned = toAscii(input.trim()).toLowerCase();
    if (cleaned.length > MAX_LENGTH || !SHAPE.test(cleaned)) {
        return null;
    }
    return cleaned;
}

/**
 * The form to show back to the reader. The canonical form IS the readable form for an
 * address, so this is the identity - it exists so the ledger and the receipt read the same
 * as they did with `displayPhone`, and so there is somewhere obvious to put a change of mind.
 */
export function displayEmail(canonical: string): string {
    return canonical;
}

/**
 * The shared field. It VALIDATES only - it trims, and it does not canonicalise, so the value
 * arrives at a handler in whatever shape the buyer typed. Every handler therefore runs
 * `normalizeEmail` before storing or sending; nothing downstream may assume a canonical value
 * just because validation passed.
 *
 * The Persian message is what the form displays, so it is written for a buyer, not a
 * developer.
 */
export const emailField: z.ZodType<string> = z
    .string()
    .trim()
    .max(MAX_LENGTH, { message: 'ایمیل معتبر نیست' })
    .refine((value) => normalizeEmail(value) !== null, { message: 'ایمیل معتبر نیست' });
