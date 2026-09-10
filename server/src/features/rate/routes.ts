// The console's window onto the rate. One read-only route.
//
// It exists so that "the shop is not selling" is never a mystery: the operator sees what each
// exchange answered, how far apart they were, how old the agreed rate is, and the margin
// being applied on top of it - which together answer every question the cards can raise.
import type { Handlers } from '../../platform/api.ts';
import type { contract } from '../../contract/index.ts';
import type { Settings } from '../settings/settings.ts';
import type { TetherRate } from './rate.ts';

export interface RateOptions {
    rate: TetherRate;
    settings: Settings;
}

/** Only this feature's route. app.ts merges it into the `admin` group. */
type RateHandlers = Pick<Handlers<typeof contract>['admin'], 'rate'>;

export function rateHandlers(options: RateOptions): RateHandlers {
    return {
        // GET /api/admin/rate
        rate: () => ({
            ...options.rate.status(),
            marginPercent: options.settings.current().marginPercent
        })
    };
}
