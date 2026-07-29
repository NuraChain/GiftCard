// The console's session, shared by all four tabs.
//
// A store rather than per-page state: moving between tabs must not re-ask whether the
// operator is signed in, and being signed out on one tab must lock the others immediately.
//
// It holds NO credential. The key is typed once, posted, and forgotten; what the browser
// keeps is an HttpOnly cookie no script here can read - including this one.
import { createSignal, createStore } from 'azerothjs';

import { client } from '../../api.ts';

export const useAdminSession = createStore(() =>
{
    const [unlocked, setUnlocked] = createSignal(false);
    const [checked, setChecked] = createSignal(false);

    /**
     * Bumped every time the session becomes usable. Each tab watches it and (re)loads.
     *
     * This exists because a tab's markup - including its `mount` - is built when the ROUTE
     * renders, which is before anyone has signed in. Its first fetch therefore 401s against
     * the lock screen, and without a signal to reload against, the operator saw an empty tab
     * until they refreshed the page by hand.
     */
    const [revision, setRevision] = createSignal(0);

    /**
     * Confirms the session against the cheapest guarded route there is. Every tab calls this
     * on mount; the `checked` flag is what keeps the lock screen from flashing before the
     * answer arrives.
     */
    const verify = async (): Promise<boolean> =>
    {
        try
        {
            await client.admin.overview();
            setUnlocked(true);
            setRevision((n) => n + 1);
            return true;
        }
        catch
        {
            setUnlocked(false);
            return false;
        }
        finally
        {
            setChecked(true);
        }
    };

    return {
        unlocked,
        checked,
        revision,
        verify,
        signIn: async (key: string): Promise<void> =>
        {
            await client.admin.signIn({ input: { key } });
            setUnlocked(true);
            setChecked(true);
            setRevision((n) => n + 1);
        },
        signOut: async (): Promise<void> =>
        {
            await client.admin.signOut().catch(() => undefined);
            setUnlocked(false);
            setChecked(true);
        },
        /** Called when a guarded request comes back 401 mid-session. */
        expire: (): void =>
        {
            setUnlocked(false);
            setChecked(true);
        }
    };
});

/** True when a failed request means "your session ended" rather than "something broke". */
export function isUnauthorized(error: unknown): boolean
{
    return typeof error === 'object' && error !== null && (error as { status?: number }).status === 401;
}
