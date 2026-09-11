// The shapes the database speaks, and the queries it answers.
//
// One file for the vocabulary so the four query modules beside it - orders, codes, tiers,
// settings - can be read on their own without chasing definitions across the layer.

/** Where an order is in its life; `pending` is the only non-terminal state. */
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'failed';

/**
 * A denomination, in dollars. Deliberately a plain number rather than a union: the
 * catalogue is editable at runtime, so the set of valid amounts is a TABLE, not a type.
 *
 * The union it replaced was a security control - "an unlisted amount is a forged request" -
 * and losing a type does not get to lose the rule. `routes/pay.ts` checks the amount against
 * the live tier table before anything else happens. That check IS the old union.
 */
export type Amount = number;

/** One sellable denomination, as the shop shows it and the console edits it. */
export interface Tier {
    /** The dollar figure, and the row's identity. */
    amount: Amount;

    title: string;
    blurb: string;

    /** At most one card carries the recommended treatment; the store enforces that. */
    recommended: boolean;

    /** Inactive means unbuyable. It does NOT mean deleted: history keeps its amount. */
    active: boolean;

    sort: number;
}

/** What the console sends when adding or editing a card. */
export type TierInput = Tier;

/** Why a tier could not be removed outright, so the console can say which. */
export type TierRemoval = 'deleted' | 'deactivated' | 'missing';

export interface Order {
    /** The public receipt handle: 32 random characters, and the row's primary key. */
    id: string;

    /** Zarinpal's handle, set once the gateway has accepted the request. */
    authority: string | null;

    amount: Amount;

    /** What the buyer pays, in Toman. Stored so verify uses OUR number, not a request's. */
    toman: number;

    /** Canonical: trimmed and lowercased. See domain/email.ts. */
    email: string;

    status: OrderStatus;

    /**
     * The delivered code. `status === 'paid'` with a null code is the OWED state: the money
     * verified and no code was available. It is rare, it is real, and it is named here so
     * the receipt and the ledger can both act on it.
     */
    code: string | null;

    /** Zarinpal's transaction reference, quoted in support. */
    refId: number | null;

    /** Whether the code reached the buyer by email. False never invalidates the code. */
    mailDelivered: boolean;

    createdAt: string;
    settledAt: string | null;
}

/** What a purchase knows before the gateway has said anything. */
export interface NewOrder {
    id: string;
    amount: Amount;
    toman: number;
    email: string;
    createdAt: string;
}

/** One denomination's inventory, as the shop and the console both need it. */
export interface StockLine {
    amount: Amount;
    available: number;
    held: number;
    sold: number;
}

/** What a paste of codes did. Nothing is swallowed: every line is accounted for. */
export interface AddCodesResult {
    added: number;
    duplicate: number;

    /** The lines that were not canonical UUIDs, returned verbatim so they can be fixed. */
    invalid: string[];
}

/**
 * Where one code stands. `held` is reserved by a checkout in flight; `sold` means it was
 * handed to a buyer and is gone for good.
 */
export type CodeState = 'free' | 'held' | 'sold';

/** One row of the inventory, joined to whoever received it. */
export interface CodeRow {
    code: string;
    amount: Amount;
    state: CodeState;
    addedAt: string;

    /** The buyer, once there is one. Canonical, lowercased. */
    email: string | null;

    /** When the order that took it settled. */
    soldAt: string | null;

    /** The bank reference of the paying order, for matching against a statement. */
    refId: number | null;
}

/**
 * A payout request: one gift code, spent, and where its value was asked to go.
 *
 * The row IS the spend. There is no "redeemed" flag anywhere else, so this table existing is
 * the only thing that stops a code being cashed twice - see platform/schema.ts.
 */
export interface Redemption {
    /** The code that was consumed, canonical and lowercased. The row's identity. */
    code: string;

    /** The denomination, copied at redemption time so the row survives the code being gone. */
    amount: Amount;

    /** Where to send it, exactly as the holder gave it - case included. See domain/wallet.ts. */
    wallet: string;

    /** `TRC20` or `ERC20`, derived from the address shape. The chain the operator must use. */
    network: string;

    /** Who bought the code. Copied from the order, so support has a name to match against. */
    email: string;

    /**
     * Whether the operator has actually been told. FALSE IS THE DANGEROUS STATE: the code is
     * spent and nobody knows a transfer is owed, so the bot reports these in `/status`.
     */
    notified: boolean;

    claimedAt: string;
}

/**
 * What a redemption attempt did. Three outcomes, and the caller must tell them apart:
 * `unknown` covers both "no such code" and "that code was never sold" - deliberately one
 * answer, because distinguishing them would confirm a guess at unsold inventory.
 */
export type RedeemOutcome =
    | { state: 'claimed'; redemption: Redemption }
    | { state: 'unknown' }
    | { state: 'spent'; at: string };

/** One page of the ledger. An empty `search` means the whole ledger. */
export interface OrderQuery {
    /** Free text: part of an email address, a code, a reference, or a receipt handle. */
    search: string;

    limit: number;
    offset: number;
}

/** One page of the inventory. */
export interface CodeQuery {
    /** Free text over the code itself and over the buyer's address. */
    search: string;

    /** Narrow to one state, or `null` for all three. */
    state: CodeState | null;

    /** Narrow to one denomination, or `null` for all. */
    amount: Amount | null;

    limit: number;
    offset: number;
}

/** One recorded settings change. Values are masked before they reach here. */
export interface SettingsLogEntry {
    key: string;
    before: string;
    after: string;
    changedAt: string;
}

/**
 * The settings half of the store, kept as its own interface so `features/settings/settings.ts`
 * depends on the four calls it needs rather than on the whole database.
 */
export interface SettingsStore {
    /** The raw stored string - sealed, if it is a secret. undefined means "never set". */
    getSetting(key: string): string | undefined;

    putSetting(key: string, value: string): void;

    logSetting(entry: SettingsLogEntry): void;

    settingsLog(limit: number): SettingsLogEntry[];
}

/** Everything the application asks of the database. */
export interface Store extends SettingsStore {
    // --- The catalogue ---

    /** Every tier, ordered for display. `active: false` ones are included - the console needs them. */
    tiers(): Tier[];

    /**
     * The one a purchase is allowed to use: present AND active. Returns undefined otherwise,
     * which is the check that replaced the old `5 | 10 | 25` union at the boundary.
     */
    sellableTier(amount: Amount): Tier | undefined;

    saveTier(tier: TierInput): void;

    /**
     * Removes a tier, or deactivates it when codes or orders reference it - history must
     * keep the amount it was sold under. The return value says which happened.
     */
    removeTier(amount: Amount): TierRemoval;

    /** True when the catalogue has never been populated, so boot can seed it once. */
    isCatalogueEmpty(): boolean;

    // --- Inventory ---

    stock(): StockLine[];
    availableFor(amount: Amount): number;
    addCodes(amount: Amount, codes: string[]): AddCodesResult;

    /** One page of the code inventory itself: what was loaded, and where each one went. */
    searchCodes(query: CodeQuery): { rows: CodeRow[]; total: number };

    // --- Orders ---

    /**
     * Reserves one free code for `orderId` and inserts the pending order, in ONE
     * transaction. Returns false when the denomination is sold out - the caller must then
     * refuse the purchase rather than send the buyer to pay for nothing.
     */
    startOrder(order: NewOrder, holdMs: number): boolean;

    /**
     * Binds the gateway's handle to the order. False means the handle is already bound to
     * a different order - the caller must then abandon this one rather than proceed with a
     * payment it could not find on the way back.
     */
    attachAuthority(orderId: string, authority: string): boolean;

    /** Undoes {@link Store.startOrder} when the gateway refuses to open the payment. */
    abandonOrder(orderId: string): void;

    orderById(id: string): Order | undefined;
    orderByAuthority(authority: string): Order | undefined;

    /**
     * Settles a verified payment: keeps the held code (or claims a fresh one if the hold
     * lapsed and it was taken), and returns the code, or null for the owed state.
     */
    settlePaid(orderId: string, refId: number): string | null;

    /** Settles an unpaid attempt and returns the held code to stock. */
    settleUnpaid(orderId: string, status: 'cancelled' | 'failed'): void;

    markMailDelivered(orderId: string, delivered: boolean): void;

    /** The ledger, newest first, owed orders pinned to the top. */
    recentOrders(limit: number): Order[];

    /** One page of the ledger, plus how many rows the search matched in total. */
    searchOrders(query: OrderQuery): { rows: Order[]; total: number };

    /** Paid orders with no code, across the WHOLE table - not just the page being shown. */
    owedCount(): number;

    // --- Redemptions ---

    /**
     * Spends a code against a wallet address, ONCE.
     *
     * The whole double-spend guard is here: the insert is against a table keyed on the code,
     * so two simultaneous requests for one code produce one `claimed` and one `spent` no
     * matter how they interleave. A code that was never sold is `unknown` - a free code is
     * inventory the shop still owns, and redeeming one would be giving it away.
     */
    redeemCode(code: string, wallet: string, network: string): RedeemOutcome;

    /** Records that the operator was actually told. See {@link Redemption.notified}. */
    markRedemptionNotified(code: string): void;

    /** How many spent codes nobody has been told about. Somebody is waiting on each of these. */
    unnotifiedRedemptions(): number;

    /**
     * Writes a CONSISTENT snapshot of the whole database to `file`.
     *
     * Through SQLite itself, not a file copy: copying the file while the shop is trading
     * captures a half-written page and a WAL that does not match it, which restores to
     * nothing. This is what the hourly Telegram backup sends.
     */
    backupTo(file: string): void;

    close(): void;
}
