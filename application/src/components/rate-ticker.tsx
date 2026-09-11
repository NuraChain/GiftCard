// The tether price the shop is selling on, and its honesty about how current that is.
//
// Every card's price is a dollar figure multiplied by this number, so putting it on the page
// is not decoration - it is the working. A reader who can see the rate can check the card
// price themselves, and a shop that shows the rate it is pricing off is making a claim it can
// be held to. Hiding it would leave "چرا این کارت انقدر شد؟" with no answer.
//
// THE AGE IS PART OF THE PRICE, and it matters more now than it used to. The rate is set by
// hand in the console rather than read off an exchange, so nothing refreshes it and only the
// shop's own operator can notice it has drifted. The age is therefore shown always, it
// re-renders on its own clock rather than waiting for the next poll, and when the server marks
// the rate stale the strip says so rather than dressing an old number as a current one.
//
// THREE STATES, and the third is the one that matters. No rate at all is not "loading" and it
// is not a blank - it is the shop telling you it cannot price anything right now, in the same
// words the cards use when they refuse to be bought.
import { RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useCatalog } from '../lib/catalog.tsx';
import { ago, toman } from '../lib/format.ts';

/**
 * How often the «چند دقیقه پیش» label recomputes.
 *
 * It is its own timer rather than a side effect of the catalogue poll because the two fail
 * independently: when the network is down the poll stops returning and the rate object stops
 * changing, and without this the strip would sit there insisting the price is fresh. The age
 * has to keep counting even - especially - when nothing else is happening.
 */
const TICK_MS = 30_000;

export default function RateTicker(): ReactNode {
    const catalog = useCatalog();
    const [, tick] = useState(0);

    // `?? null` rather than a bare read: during a deploy nginx can be serving this bundle
    // while the previous server is still answering, and that server's catalogue has no
    // `rate` field at all. Reading `.stale` off the undefined would throw inside render and
    // take the WHOLE SHOP down to a blank page over a strip of text.
    const rate = catalog.rate ?? null;

    useEffect(() => {
        const timer = setInterval(() => tick((value) => value + 1), TICK_MS);
        return () => clearInterval(timer);
    }, []);

    // Before the first answer there is nothing true to say. A placeholder rate would be the
    // one kind of wrong this component exists to prevent.
    if (!catalog.loaded) {
        return null;
    }

    if (rate === null) {
        return (
            <div className="border-b border-gold/40 bg-gold/10">
                <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 text-caption sm:px-5">
                    <TriangleAlert className="size-4 shrink-0 text-gold" aria-hidden="true" />
                    <span>
                        قیمت تتر هنوز تنظیم نشده، برای همین خرید موقتاً ممکن نیست. کمی بعد دوباره سر
                        بزنید.
                    </span>
                </p>
            </div>
        );
    }

    const stale = rate.stale;

    return (
        <div
            className={`border-b ${stale ? 'border-gold/40 bg-gold/10' : 'border-line bg-surface/60'}`}
        >
            {/* `flex-wrap` rather than a fixed row: at 400px the price and its age do not fit
                on one line, and wrapping reads better than shrinking the one number the strip
                exists to show. */}
            <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-caption sm:px-5">
                <span className="flex items-center gap-2 font-bold">
                    {stale ? (
                        <TriangleAlert className="size-4 shrink-0 text-gold" aria-hidden="true" />
                    ) : (
                        <TrendingUp className="size-4 shrink-0 text-firouze" aria-hidden="true" />
                    )}
                    قیمت تتر
                </span>

                <span className="font-bold">{toman(rate.toman)} تومان</span>

                <span className="flex items-center gap-1.5 text-muted">
                    <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
                    {ago(rate.at)}
                </span>

                {stale && (
                    <span className="text-gold">
                        این نرخ مدتی است به‌روز نشده است. قیمت کارت‌ها ممکن است تغییر کند.
                    </span>
                )}

                <span className="text-muted">قیمت هر کارت از همین نرخ حساب می‌شود.</span>
            </p>
        </div>
    );
}
