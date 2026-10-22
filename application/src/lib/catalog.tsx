// The shop's view of the catalogue: one fetch, shared by the cards, the header, the tether
// ticker and the console's title.
//
// It is a context rather than page state because several components need the same answer and
// must not ask three times - and because a card has to know it is sold out at the moment the
// buyer presses pay, not at the moment the page loaded.
//
// IT POLLS NOW, and that is not a nicety. Prices are derived from a rate the console moves,
// and a page left open for twenty minutes would otherwise show a number the server has
// already stopped honouring - the buyer presses pay, the server refuses on the price
// agreement, and they get an error where they should have got a card. Re-reading once a
// minute keeps the page and the server saying the same thing.
//
// The poll is QUIET: it does not raise the loading flag and does not clear the error, so a
// refresh in the background can never blank the shop the reader is looking at. It also stops
// while the tab is hidden, because a backgrounded tab asking for prices all afternoon is
// somebody else's bandwidth.
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';

import { client } from './api.ts';
import {
    NO_SHOP_NAMES,
    shopName,
    type Catalog,
    type ShopNames
} from '../../../server/src/contract/index.ts';
import { useLang } from './lang.ts';

/** One card, exactly as the server describes it. */
export type CatalogTier = Catalog['tiers'][number];

/** How often the shop re-reads prices, so a rate set in the console reaches an open tab. */
const POLL_MS = 60_000;

/** What a shop with no answer yet calls itself. Replaced the moment the catalogue lands. */
const FALLBACK_NAME = 'اشبرینگر';

/**
 * Where the first paint's name comes from.
 *
 * The server used to stamp the configured name into the served HTML, and that stopped being
 * possible when nginx took over serving a BUILT file - a static file cannot carry a value
 * that lives in a database. So the last known name is remembered in the browser instead: a
 * returning visitor paints the right brand immediately, and a first-time visitor sees the
 * fallback for exactly as long as one fetch takes.
 *
 * Wrapped because storage throws outright in some privacy modes, and a brand name is not
 * worth a blank page.
 *
 * PRICES ARE NOT REMEMBERED THIS WAY, deliberately. A brand name from last week is still
 * the brand name; a price from last week is a lie, and a cached one would survive exactly the
 * rate change it most needs to notice.
 */
function rememberedName(): string {
    try {
        return localStorage.getItem('ashbringer-app-name') ?? FALLBACK_NAME;
    } catch {
        return FALLBACK_NAME;
    }
}

/** The other languages' names, remembered for the same first paint. */
function rememberedNames(): ShopNames {
    try {
        const held = JSON.parse(localStorage.getItem('ashbringer-app-names') ?? '{}') as unknown;
        return { ...NO_SHOP_NAMES, ...(typeof held === 'object' && held !== null ? held : {}) };
    } catch {
        return NO_SHOP_NAMES;
    }
}

export interface CatalogStore {
    tiers: CatalogTier[];

    /** The Persian name. Every other page reads `useShopName`, which falls back for them. */
    appName: string;
    appNames: ShopNames;

    /** Whether the English shop can take a payment - Plisio has a key. See the contract. */
    englishOpen: boolean;

    loading: boolean;
    error: string;
    loaded: boolean;

    /** Re-reads the catalogue, showing the skeleton. Use `refresh` for a background read. */
    load: () => Promise<void>;

    /** Re-reads without disturbing what is on screen. */
    refresh: () => Promise<void>;
}

/** What `error` holds when the catalogue could not be read. */
export const CATALOG_UNAVAILABLE = 'catalog-unavailable';

const CatalogContext = createContext<CatalogStore | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }): ReactNode {
    const [tiers, setTiers] = useState<CatalogTier[]>([]);
    const [appName, setAppName] = useState(rememberedName);
    const [appNames, setAppNames] = useState(rememberedNames);
    const [englishOpen, setEnglishOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);

    const read = useCallback(async (quiet: boolean): Promise<void> => {
        if (!quiet) {
            setLoading(true);
            setError('');
        }
        try {
            const result = await client.pay.catalog();
            setTiers(result.tiers);
            setAppName(result.appName);
            // Spread over the empty set for an older server mid-deploy, which has none yet.
            setAppNames({ ...NO_SHOP_NAMES, ...result.appNames });
            // `=== true`: an older server mid-deploy answers without the field, and that
            // shop has no English checkout to open.
            setEnglishOpen(result.englishOpen === true);
            setLoaded(true);
            setError('');

            // The TAB TITLE is set by the shell, which knows which shop's words to use - see
            // App.tsx. It follows `appName`, so a rebrand still reaches the browser tab.
            try {
                localStorage.setItem('ashbringer-app-name', result.appName);
                localStorage.setItem('ashbringer-app-names', JSON.stringify(result.appNames));
            } catch {
                // No storage: the name is still right for this visit.
            }
        } catch {
            // Named, not swallowed. A silent failure here used to leave the shop looking
            // open with no prices on it, which reads as broken rather than as unavailable.
            //
            // A QUIET read that fails says nothing: the page already has prices on it, and
            // replacing them with an error because one background poll missed would be a
            // worse answer than the slightly older number already on screen. The next poll
            // either fixes it or the buyer meets the server's price check, which is exactly
            // the backstop that exists for this.
            if (!quiet) {
                // A KEY, not a sentence: this provider sits above the router and cannot know
                // which shop's words to use. The shop page turns it into the reader's language.
                setError(CATALOG_UNAVAILABLE);
            }
        } finally {
            if (!quiet) {
                setLoading(false);
            }
        }
    }, []);

    const load = useCallback((): Promise<void> => read(false), [read]);
    const refresh = useCallback((): Promise<void> => read(true), [read]);

    // The timer reads the LATEST refresh through a ref rather than depending on it, so the
    // interval is installed once instead of being torn down and rebuilt on every render.
    const latest = useRef(refresh);
    useEffect(() => {
        latest.current = refresh;
    }, [refresh]);

    useEffect(() => {
        const tick = (): void => {
            if (document.visibilityState === 'visible') {
                void latest.current();
            }
        };
        const timer = setInterval(tick, POLL_MS);

        // Coming back to a backgrounded tab should not mean waiting up to a minute to find
        // out the price changed while it was away.
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', tick);
        };
    }, []);

    const store = useMemo(
        () => ({ tiers, appName, appNames, englishOpen, loading, error, loaded, load, refresh }),
        [tiers, appName, appNames, englishOpen, loading, error, loaded, load, refresh]
    );

    return <CatalogContext value={store}>{children}</CatalogContext>;
}

export function useCatalog(): CatalogStore {
    const store = useContext(CatalogContext);
    if (store === null) {
        throw new Error('useCatalog was called outside <CatalogProvider>');
    }
    return store;
}

/**
 * What the shop is called on the reader's page: the name set for that language, else the
 * English one, else the Persian one. Must be used under the router.
 */
export function useShopName(): string {
    const { appName, appNames } = useCatalog();
    return shopName(useLang(), appName, appNames);
}
