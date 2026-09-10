// The settings tab: three unrelated jobs, three components, one page.
//
// They share a tab because an operator thinks of them as "the shop's own controls", not
// because they share any state - each loads and saves independently, so one failing to load
// does not blank the other two.
//
// All three change something that costs money or access, and each guards itself: the
// merchant id asks for confirmation, a tier removal says which of the two things it did,
// and rotating the key demands the current one even though a session is already open.
import type { ReactNode } from 'react';

import AdminShell from '../shell.tsx';
import TierSettings from './tiers.tsx';
import GatewaySettings from './gateway.tsx';
import AdminKeySettings from './admin-key.tsx';

export default function AdminSettings(): ReactNode {
    return (
        <AdminShell>
            <TierSettings />
            <GatewaySettings />
            <AdminKeySettings />
        </AdminShell>
    );
}
