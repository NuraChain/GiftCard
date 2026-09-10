// Numbers and dates in the reader's own script.
//
// `Intl` is in every browser this app supports, so there is no digit-mapping table here:
// `fa-IR` produces Persian digits AND the Persian thousands separator, which a hand-rolled
// replace would get subtly wrong.

const TOMAN = new Intl.NumberFormat('fa-IR');
const MOMENT = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
const YEAR = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' });

/**
 * `numeric: 'auto'` is what produces «دیروز» instead of «۱ روز پیش». It only ever improves
 * the wording, and it is the difference between a ticker that reads like a sentence and one
 * that reads like a log line.
 */
const RELATIVE = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });

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
 * How long ago something happened, in words: «همین حالا», «۳ دقیقه پیش».
 *
 * Used by the tether ticker, where the AGE of the number is as much of the message as the
 * number itself - a rate is only worth reading if you know it is current, and «۱۴:۰۲» makes
 * the reader do that subtraction themselves.
 *
 * The buckets stop at days because nothing this is used for survives that long: a rate older
 * than fifteen minutes has already stopped being sellable (server: features/rate/rate.ts).
 */
export function ago(iso: string): string {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(seconds)) {
        return '';
    }
    if (seconds < 45) {
        return 'همین حالا';
    }
    if (seconds < 3600) {
        return RELATIVE.format(-Math.round(seconds / 60), 'minute');
    }
    if (seconds < 86_400) {
        return RELATIVE.format(-Math.round(seconds / 3600), 'hour');
    }
    return RELATIVE.format(-Math.round(seconds / 86_400), 'day');
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
