// Numbers and dates in the reader's own script.
//
// `Intl` is in every browser this app supports, so there is no digit-mapping table here:
// `fa-IR` produces Persian digits AND the Persian thousands separator, which a hand-rolled
// replace would get subtly wrong.

const TOMAN = new Intl.NumberFormat('fa-IR');
const MOMENT = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });

/** A price, in Persian digits, without the unit - the unit is written in the markup. */
export function toman(value: number): string
{
    return TOMAN.format(value);
}

/** A plain count: `۷`. */
export function count(value: number): string
{
    return TOMAN.format(value);
}

/** A timestamp for the ledger, in the Persian calendar. */
export function moment(iso: string): string
{
    return MOMENT.format(new Date(iso));
}
