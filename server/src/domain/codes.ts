// Identifiers the shop mints for itself.
//
// The gift codes are NOT minted here - they are inventory, loaded by the operator from a
// supplier. What this file makes is the handle the browser carries back from the bank.

/** The alphabet excludes I/O/0/1 - the characters people misread reading aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The public receipt handle. It travels in a URL and is never spoken, so its only job is to
 * be infeasible to guess - 32 characters over a 32-symbol alphabet, from a CSPRNG.
 *
 * It is separate from Zarinpal's `authority` on purpose: the result page can be reloaded and
 * shared without exposing the value the gateway keys payments on.
 */
export function mintReceiptToken(): string
{
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}
