// The shop's view of the catalogue: one fetch, shared by the cards and the purchase panel.
//
// It is a store rather than page state because two components need the same answer and must
// not ask twice - and because the panel has to know a tier is sold out at the moment the
// buyer presses pay, not at the moment the page loaded.
import { createSignal, createStore } from 'azerothjs';

import { client } from './api.ts';
import type { Catalog } from '../../../server/src/contract/index.ts';

/** One card, exactly as the server describes it. */
export type CatalogTier = Catalog['tiers'][number];

/**
 * The name to paint FIRST. The server stamps the configured one into a meta tag, so the
 * browser has it before any fetch - reading it is synchronous, where the catalogue is not.
 * Without this the first paint showed a default the operator may have renamed away from.
 */
function initialName(): string
{
    if (typeof document === 'undefined')
    {
        return 'نورا چین';
    }
    const meta = document.querySelector('meta[name="app-name"]');
    const stamped = meta?.getAttribute('content') ?? '';
    return stamped === '' ? 'نورا چین' : stamped;
}

export const useCatalog = createStore(() =>
{
    const [tiers, setTiers] = createSignal<CatalogTier[]>([]);
    const [appName, setAppName] = createSignal(initialName());
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal('');
    const [loaded, setLoaded] = createSignal(false);

    const load = async (): Promise<void> =>
    {
        setLoading(true);
        setError('');
        try
        {
            const result = await client.pay.catalog();
            setTiers(result.tiers);
            setAppName(result.appName);
            setLoaded(true);

            // The title lives in the built shell, so a rebrand would leave it stale. Setting
            // it here is what makes the name in the console the name in the browser tab.
            if (typeof document !== 'undefined')
            {
                document.title = `${ result.appName } - خرید گیفت کارت`;
            }
        }
        catch
        {
            // Named, not swallowed. A silent failure here used to leave the shop looking
            // open with no prices on it, which reads as broken rather than as unavailable.
            setError('فهرست کارت‌ها بارگذاری نشد. اتصال اینترنت را بررسی کنید.');
        }
        finally
        {
            setLoading(false);
        }
    };

    return { tiers, appName, loading, error, loaded, load };
});
