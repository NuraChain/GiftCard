// Email addresses, normalised to ONE canonical form - the English shop's equivalent of
// domain/phone.ts, which does the same job for the mobile number the Persian shop texts.
//
// It lives in domain/ because the contract imports it, and the contract is client-safe by
// construction - so the browser form and the server boundary run this exact rule rather than
// two hand-written regexes that drift.
//
// WHAT GETS STRIPPED BEFORE VALIDATION, and why it is more than a regex:
//
//   ali۱۲۳@gmail.com    Persian digits - a buyer on a Persian keyboard layout types these by
//                       default, even in the English shop.
//   ali‌@gmail.com       a ZERO-WIDTH NON-JOINER, which Persian typing inserts constantly and
//                       which is INVISIBLE. An address that looks identical to a correct one
//                       and is silently undeliverable is the worst failure here, because the
//                       buyer has already paid by the time anyone finds out.
//   ‪ali@gmail.com‬       bidirectional control marks, pasted in from an RTL document.
//
// THE VALIDATION IS DELIBERATELY NOT RFC 5322. The full grammar accepts quoted strings,
// comments and bracketed IP literals, none of which a buyer of a gift card has ever typed.
// What is here is the shape a deliverable address takes: something, an @, a dotted domain, no
// spaces.
import { z } from 'zod';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Zero-width joiners, the byte-order mark, and the bidi marks an RTL editor sprinkles in. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

/** The longest address anything sane will accept. */
const MAX_LENGTH = 254;

/**
 * Something, an @, a dotted domain. At least one dot in the domain, so `ali@gmail` - usually a
 * half-typed address rather than an intranet host - does not pass.
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
 * The canonical form: trimmed, cleaned of invisibles, lowercased - or null when the input is
 * not a deliverable-looking address.
 *
 * LOWERCASING THE WHOLE ADDRESS is a deliberate simplification: no mail provider a buyer uses
 * treats the local part as case-sensitive, and one stored shape is what lets the ledger search
 * find the order the buyer is asking about.
 */
export function normalizeEmail(input: string): string | null {
    const cleaned = toAscii(input.trim()).toLowerCase();
    if (cleaned.length > MAX_LENGTH || !SHAPE.test(cleaned)) {
        return null;
    }
    return cleaned;
}

/**
 * The shared field. It VALIDATES only - it trims and does not canonicalise - so every handler
 * runs `normalizeEmail` before storing or sending.
 *
 * The message is ENGLISH because the one form that uses this is the English shop's.
 */
export const emailField: z.ZodType<string> = z
    .string()
    .trim()
    .max(MAX_LENGTH, { message: 'Enter a valid email address' })
    .refine((value) => normalizeEmail(value) !== null, {
        message: 'Enter a valid email address'
    });
