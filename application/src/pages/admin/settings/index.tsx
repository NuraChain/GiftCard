// The settings tab: seven unrelated jobs, seven components, one page.
//
// They share a tab because an operator thinks of them as "the shop's own controls", not
// because they share any state - each loads and saves independently, so one failing to load
// does not blank the others, and each form sends ONLY its own fields. The server treats an
// absent field as unchanged, which is what makes that safe: saving the mail server cannot
// touch the merchant id, and neither can touch the tether rate.
//
// THE GATEWAY AND THE MAIL SERVER USED TO SHARE ONE FORM. They are apart now because they
// fail apart - a broken mail key stops delivery, a wrong merchant id sends the takings to
// a stranger - and an operator fixing one should never be editing a form that can save the
// other. The shop NAME sits in its own card above both for the same reason: it is the tab
// title, the mail subject AND the transaction description, so it belongs to neither.
//
// Every one of these changes something that costs money, access, or secrecy, and each guards
// itself: the merchant id asks for confirmation, the rate and the margin ask too (they
// multiply every card at once), a tier removal says which of the two things it did, sending
// the database to Telegram asks before it does it, and rotating the key demands the current
// one even though a session is already open.
//
// PRICING SITS SECOND, right under the catalogue. The cards above it no longer carry prices -
// they carry denominations - so the panel that explains what those cost belongs next to them
// rather than below the gateway credentials.
import type { ReactNode } from 'react';

import AdminShell from '../shell.tsx';
import TierSettings from './tiers.tsx';
import PricingSettings from './pricing.tsx';
import ShopSettings from './shop.tsx';
import GatewaySettings from './gateway.tsx';
import EmailSettings from './email.tsx';
import TelegramSettings from './telegram.tsx';
import AdminKeySettings from './admin-key.tsx';

export default function AdminSettings(): ReactNode {
    return (
        <AdminShell>
            <TierSettings />
            <PricingSettings />
            <ShopSettings />
            <GatewaySettings />
            <EmailSettings />
            <TelegramSettings />
            <AdminKeySettings />
        </AdminShell>
    );
}
