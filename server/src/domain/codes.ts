// Identifiers the shop mints for itself.
//
// The gift codes are NOT minted here - they are inventory, loaded by the operator from a
// supplier. What this file makes is the handle the browser carries back from the bank; what it
// also holds is the one rule for what a supplied code has to LOOK like, because the inventory
// and the redemption route both have to agree on that and the contract needs it too.

/** The alphabet excludes I/O/0/1 - the characters people misread reading aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The public receipt handle. It travels in a URL and is never spoken, so its only job is to
 * be infeasible to guess - 32 characters over a 32-symbol alphabet, from a CSPRNG.
 *
 * It is separate from Zarinpal's `authority` on purpose: the result page can be reloaded and
 * shared without exposing the value the gateway keys payments on.
 */
export function mintReceiptToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/**
 * The shape a gift code takes: canonical 8-4-4-4-4 lowercase hex.
 *
 * It lives HERE rather than beside the SQL because two boundaries need it now - the inventory
 * refuses to store anything else (features/inventory/queries.ts), and redemption refuses to
 * look anything else up. This file is reachable from the contract, so the browser form runs
 * the same rule.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Characters with no glyph and no meaning, which a paste out of a Persian chat or an RTL
 * document carries along invisibly. See domain/email.ts - the failure they cause is the same
 * one and it is just as unexplainable on screen.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * The one stored spelling of a code, or null when it is not a code at all.
 *
 * A buyer reading one back off an email arrives with any of: trailing whitespace, uppercase
 * (mail clients and phone keyboards both do this), and invisible marks from the paste. All
 * three describe the same code, and the inventory holds exactly one of those spellings - so
 * a lookup that skipped this would tell a paying customer their own code does not exist.
 */
export function normalizeGiftCode(raw: string): string | null {
    const code = raw.replace(INVISIBLE, '').trim().toLowerCase();
    return UUID.test(code) ? code : null;
}
