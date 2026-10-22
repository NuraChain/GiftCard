// The console's session, shared by all four tabs.
//
// A context rather than per-page state: moving between tabs must not re-ask whether the
// operator is signed in, and being signed out on one tab must lock the others immediately.
//
// It holds NO credential. The key is typed once, posted, and forgotten; what the browser
// keeps is an HttpOnly cookie no script here can read - including this one.
import { createContext, createSignal, provideContext, useContext } from 'azerothjs';

import { client } from '../../lib/api.ts';

export interface AdminSession {
    readonly unlocked: boolean;

    /** False until the first answer is in. What keeps the lock screen from flashing. */
    readonly checked: boolean;

    /**
     * Bumped every time the session becomes usable. Each tab watches it and (re)loads.
     *
     * This exists because a tab is mounted by the ROUTE, which happens before anyone has
     * signed in. Its first fetch would therefore 401 against the lock screen, and without a
     * value to react to, the operator saw an empty tab until they refreshed by hand.
     */
    readonly revision: number;

    verify(): Promise<boolean>;
    signIn(key: string): Promise<void>;
    signOut(): Promise<void>;

    /** Called when a guarded request comes back 401 mid-session. */
    expire(): void;
}

const SessionContext = createContext<AdminSession>(undefined, 'AdminSession');

/** Builds the session and provides it below the caller. The shell calls it once, at setup. */
export function provideAdminSession(): AdminSession {
    const [unlocked, setUnlocked] = createSignal(false);
    const [checked, setChecked] = createSignal(false);
    const [revision, setRevision] = createSignal(0);

    const session: AdminSession = {
        get unlocked() {
            return unlocked();
        },
        get checked() {
            return checked();
        },
        get revision() {
            return revision();
        },

        /**
         * Confirms the session against the cheapest guarded route there is. The shell calls
         * this on mount; `checked` is what keeps the lock screen from appearing before the
         * answer.
         */
        async verify() {
            try {
                await client.admin.overview();
                setUnlocked(true);
                setRevision((current) => current + 1);
                return true;
            } catch {
                setUnlocked(false);
                return false;
            } finally {
                setChecked(true);
            }
        },

        async signIn(key) {
            await client.admin.signIn({ input: { key } });
            setUnlocked(true);
            setChecked(true);
            setRevision((current) => current + 1);
        },

        async signOut() {
            await client.admin.signOut().catch(() => undefined);
            setUnlocked(false);
            setChecked(true);
        },

        expire() {
            setUnlocked(false);
            setChecked(true);
        }
    };
    provideContext(SessionContext, session);
    return session;
}

export function useAdminSession(): AdminSession {
    const session = useContext(SessionContext);
    if (session === undefined) {
        throw new Error('useAdminSession was called outside the shell that provides the session');
    }
    return session;
}

/** True when a failed request means "your session ended" rather than "something broke". */
export function isUnauthorized(error: unknown): boolean {
    return (
        typeof error === 'object' && error !== null && (error as { status?: number }).status === 401
    );
}
