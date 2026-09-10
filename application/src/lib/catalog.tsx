// The shop's view of the catalogue: one fetch, shared by the cards, the header and the
// console's title.
//
// It is a context rather than page state because several components need the same answer and
// must not ask three times - and because a card has to know it is sold out at the moment the
// buyer presses pay, not at the moment the page loaded.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { client } from './api.ts';
import type { Catalog } from '../../../server/src/contract/index.ts';

/** One card, exactly as the server describes it. */
export type CatalogTier = Catalog['tiers'][number];

/** What a shop with no answer yet calls itself. Replaced the moment the catalogue lands. */
const FALLBACK_NAME = 'گاردین سرویس';

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
 */
function rememberedName(): string {
    try {
        return localStorage.getItem('guardian-app-name') ?? FALLBACK_NAME;
    } catch {
        return FALLBACK_NAME;
    }
}

export interface CatalogStore {
    tiers: CatalogTier[];
    appName: string;
    loading: boolean;
    error: string;
    loaded: boolean;
    load: () => Promise<void>;
}

const CatalogContext = createContext<CatalogStore | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }): ReactNode {
    const [tiers, setTiers] = useState<CatalogTier[]>([]);
    const [appName, setAppName] = useState(rememberedName);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError('');
        try {
            const result = await client.pay.catalog();
            setTiers(result.tiers);
            setAppName(result.appName);
            setLoaded(true);

            // The title is in a built file, so a rebrand would leave it stale. Setting it
            // here is what makes the name in the console the name in the browser tab.
            document.title = `${result.appName} - خرید گیفت کارت`;
            try {
                localStorage.setItem('guardian-app-name', result.appName);
            } catch {
                // No storage: the name is still right for this visit.
            }
        } catch {
            // Named, not swallowed. A silent failure here used to leave the shop looking
            // open with no prices on it, which reads as broken rather than as unavailable.
            setError('فهرست کارت‌ها بارگذاری نشد. اتصال اینترنت را بررسی کنید.');
        } finally {
            setLoading(false);
        }
    }, []);

    const store = useMemo(
        () => ({ tiers, appName, loading, error, loaded, load }),
        [tiers, appName, loading, error, loaded, load]
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
