// The English buyer's receipt token, kept for the trip to NOWPayments and back.
//
// The Persian gateways return the buyer through our own callback, which knows the order and
// redirects with `?receipt=` on the address. NOWPayments's page sends the buyer to ONE fixed
// address for every invoice - and the token cannot be put in it, because the token reads the
// code back and NOWPayments has no business holding it. So the browser keeps it instead, from the
// moment the invoice opens to the moment the buyer lands on `/en?pay=return`.
//
// SESSION storage: it belongs to this tab's purchase, not to the device. And every access is
// wrapped, because storage throws outright in some privacy modes - where the email is still on
// its way, and the result page says so rather than breaking.
const KEY = 'ashbringer-pending-receipt';

export function rememberReceipt(token: string): void {
    try {
        sessionStorage.setItem(KEY, token);
    } catch {
        // No storage: the code still arrives by email.
    }
}

/** The token this tab is waiting on, or an empty string. */
export function recallReceipt(): string {
    try {
        return sessionStorage.getItem(KEY) ?? '';
    } catch {
        return '';
    }
}

export function forgetReceipt(): void {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // Nothing to forget.
    }
}
