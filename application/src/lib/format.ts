// Numbers and dates in the reader's own script.
//
// `Intl` is in every browser this app supports, so there is no digit-mapping table here:
// `fa-IR` produces Persian digits AND the Persian thousands separator, which a hand-rolled
// replace would get subtly wrong.

const TOMAN = new Intl.NumberFormat('fa-IR');
const MOMENT = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
const YEAR = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' });

/** A price, in Persian digits, without the unit - the unit is written in the markup. */
export function toman(value: number): string {
    return TOMAN.format(value);
}

/** A plain count: `۷`. */
export function count(value: number): string {
    return TOMAN.format(value);
}

/** A timestamp for the ledger, in the Persian calendar. */
export function moment(iso: string): string {
    return MOMENT.format(new Date(iso));
}

/**
 * The current year, in the Persian calendar - `۱۴۰۴`. Used by the footer's copyright.
 *
 * Computed rather than written down: a hardcoded year is wrong every January, and it is
 * wrong in the one place on the page whose whole job is to look maintained.
 */
export function year(): string {
    return YEAR.format(new Date());
}
