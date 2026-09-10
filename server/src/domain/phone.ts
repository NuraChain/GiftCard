// Iranian mobile numbers, normalised to ONE canonical form.
//
// This lives in server/src because the contract imports it, and the contract is
// client-safe by construction - so the browser form and the server boundary run this
// exact rule rather than two hand-written regexes that drift.
//
// Four shapes are accepted because all four are what people actually type:
//   09170459330      the domestic form, what an Iranian writes by default
//   9170459330       the same, pasted without its leading zero
//   +989170459330    the international form
//   00989170459330   the international form as dialled from a landline
//
// Persian and Arabic-Indic digits are converted BEFORE validation. A Persian keyboard
// produces "۰۹۱۷..."; rejecting that would be a bug wearing validation's clothes.

import { z } from 'zod';

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits, in ASCII order. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** @internal Rewrites Persian/Arabic-Indic digits to ASCII and drops spaces, dashes and dots. */
function toAsciiDigits(input: string): string {
    let out = '';
    for (const character of input) {
        const persian = PERSIAN_DIGITS.indexOf(character);
        const arabic = ARABIC_DIGITS.indexOf(character);
        if (persian !== -1) {
            out += String(persian);
        } else if (arabic !== -1) {
            out += String(arabic);
        } else if (!/[\s\-.()]/.test(character)) {
            out += character;
        }
    }
    return out;
}

/**
 * The canonical form: `+989XXXXXXXXX`. Kavenegar accepts it directly (its documented
 * valid recipients include `+989121234567`), and one stored shape means a lookup by
 * phone never misses because the buyer typed it differently the second time.
 *
 * Returns null when the input is not an Iranian mobile number.
 */
export function normalizePhone(input: string): string | null {
    const digits = toAsciiDigits(input.trim());

    // Reduce every accepted prefix to the bare national number: 9XXXXXXXXX.
    let national: string;
    if (digits.startsWith('+98')) {
        national = digits.slice(3);
    } else if (digits.startsWith('0098')) {
        national = digits.slice(4);
    } else if (digits.startsWith('98') && digits.length === 12) {
        national = digits.slice(2);
    } else if (digits.startsWith('0')) {
        national = digits.slice(1);
    } else {
        national = digits;
    }

    // Every Iranian mobile is 10 digits starting with 9.
    return /^9\d{9}$/.test(national) ? `+98${national}` : null;
}

/** The form an Iranian reader expects to see back: `09XXXXXXXXX`. */
export function displayPhone(canonical: string): string {
    return canonical.startsWith('+98') ? `0${canonical.slice(3)}` : canonical;
}

/**
 * The shared field. It VALIDATES only - it trims, and it does not canonicalise, so the value
 * arrives at a handler in whatever shape the buyer typed. Every handler therefore runs
 * `normalizePhone` before storing or sending; nothing downstream may assume a canonical
 * value just because validation passed.
 *
 * The Persian message is what the form displays, so it is written for a buyer, not a
 * developer.
 */
export const phoneField: z.ZodType<string> = z
    .string()
    .trim()
    .max(20, { message: 'شماره موبایل معتبر نیست' })
    .refine((value) => normalizePhone(value) !== null, { message: 'شماره موبایل معتبر نیست' });
