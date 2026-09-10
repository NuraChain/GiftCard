// The settings tab: four unrelated jobs, four components, one page.
//
// They share a tab because an operator thinks of them as "the shop's own controls", not
// because they share any state - each loads and saves independently, so one failing to load
// does not blank the other three.
//
// All four change something that costs money or access, and each guards itself: the merchant
// id asks for confirmation, the margin asks too (it multiplies every card at once), a tier
// removal says which of the two things it did, and rotating the key demands the current one
// even though a session is already open.
//
// PRICING SITS SECOND, right under the catalogue. The cards above it no longer carry prices -
// they carry denominations - so the panel that explains what those cost belongs next to them
// rather than below the gateway credentials.
import type { ReactNode } from 'react';

import AdminShell from '../shell.tsx';
import TierSettings from './tiers.tsx';
import PricingSettings from './pricing.tsx';
import GatewaySettings from './gateway.tsx';
import AdminKeySettings from './admin-key.tsx';

export default function AdminSettings(): ReactNode {
    return (
        <AdminShell>
            <TierSettings />
            <PricingSettings />
            <GatewaySettings />
            <AdminKeySettings />
        </AdminShell>
    );
}
