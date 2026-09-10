// What a card costs, from the tether rate and one margin. The whole price formula, in one
// pure function, so there is exactly one answer to "why does this card cost that".
//
// THIS IS THE ONLY PLACE A PRICE IS PRODUCED. The shop calls it to display, checkout calls it
// to charge, and the console calls it to preview - all three from the same rate and the same
// margin, so a card cannot show one number and take another. A price computed anywhere else,
// by anyone, is a bug.
//
// It is a PURE FUNCTION on purpose: no clock, no network, no settings lookup. Everything that
// can vary is an argument, which is what makes the rounding and the margin testable without
// a rate provider and what keeps the rule readable next to the money it decides.

/**
 * Prices land on a whole thousand Toman.
 *
 * Not cosmetic. Zarinpal's own minimum is 1,000 Toman, and a price carrying digits below that
 * is noise the buyer has to read past - `۶۵۴٬۲۸۵ تومان` says nothing `۶۵۵٬۰۰۰ تومان` does not.
 */
export const PRICE_STEP_TOMAN = 1_000;

/**
 * What one card sells for, in Toman.
 *
 * Rounds UP, always. The alternatives both have a bad day: rounding down means every sale
 * gives away up to 999 Toman of a margin that was chosen deliberately, and rounding to
 * nearest means the direction depends on the rate's last three digits, which is a coin toss
 * nobody asked for. Up is at most 999 Toman over, in the shop's favour, every time.
 *
 * @param amountUsd    The card's denomination in dollars - `5` for a $5 card.
 * @param tetherToman  What one USDT costs in Toman right now.
 * @param marginPercent The shop's markup, 0-100. 6 means "six percent over the rate".
 */
export function tomanPrice(amountUsd: number, tetherToman: number, marginPercent: number): number {
    // A price is money. Rather than let a bad input become a plausible-looking number that
    // someone is then charged, this refuses outright - a 500 is recoverable, a wrong price
    // taken from a real card is not.
    if (!isPositiveFinite(amountUsd) || !isPositiveFinite(tetherToman)) {
        throw new Error('tomanPrice needs a positive amount and a positive tether rate');
    }
    if (!Number.isFinite(marginPercent) || marginPercent < 0) {
        throw new Error('tomanPrice needs a margin of zero or more');
    }

    const raw = amountUsd * tetherToman * (1 + marginPercent / 100);
    return Math.ceil(raw / PRICE_STEP_TOMAN) * PRICE_STEP_TOMAN;
}

/** @internal Rejects NaN, Infinity, zero and negatives in one call. */
function isPositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}
