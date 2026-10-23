// The shapes the database speaks, and the queries it answers.
//
// One file for the vocabulary so the four query modules beside it - orders, codes, tiers,
// settings - can be read on their own without chasing definitions across the layer.

/** Where an order is in its life; `pending` is the only non-terminal state. */
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'failed';

/**
 * Which shop an order was placed in. It is more than a language: `fa` is paid in Toman through
 * Zarinpal or Zibal and texted, `en` is paid in dollars through NOWPayments and emailed.
 */
export type OrderLang = 'fa' | 'en';

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

    /** The English shop's copy. Empty means the page words the card from its amount. */
    titleEn: string;
    blurbEn: string;

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

    /**
     * The gateway's handle, set once the gateway has accepted the request. It also records
     * WHICH gateway: a Zibal one is stored as `zibal:<trackId>` - see features/checkout/gateway.ts.
     */
    authority: string | null;

    amount: Amount;

    /**
     * What the buyer pays, in Toman. Stored so verify uses OUR number, not a request's. ZERO on
     * an `en` order, which is charged its face value in dollars - `amount` is the price there.
     */
    toman: number;

    /**
     * Where the code is sent: a canonical Iranian mobile on an `fa` order (domain/phone.ts), a
     * canonical email on an `en` one (domain/email.ts). The column kept its name.
     */
    phone: string;

    lang: OrderLang;

    status: OrderStatus;

    /**
     * The delivered code. `status === 'paid'` with a null code is the OWED state: the money
     * verified and no code was available. It is rare, it is real, and it is named here so
     * the receipt and the ledger can both act on it.
     */
    code: string | null;

    /** The gateway's transaction reference, quoted in support. */
    refId: number | null;

    /** Whether the code reached the buyer, by SMS or email. False never invalidates the code. */
    smsDelivered: boolean;

    createdAt: string;
    settledAt: string | null;
}

/** What a purchase knows before the gateway has said anything. */
export interface NewOrder {
    id: string;
    amount: Amount;
    toman: number;
    phone: string;
    lang: OrderLang;
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
    phone: string | null;

    /** When the order that took it settled. */
    soldAt: string | null;

    /** The bank reference of the paying order, for matching against a statement. */
    refId: number | null;
}

/**
 * A payout request: one gift code, spent, and where its value was asked to go.
 *
 * The row IS the spend. There is no "redeemed" flag anywhere else, so this table existing is
 * the only thing that stops a code being cashed twice - see the migration in
 * platform/migrations.
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
    phone: string;

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
    /** Free text: part of a mobile number, a code, a reference, or a receipt handle. */
    search: string;

    limit: number;
    offset: number;
}

/** One page of the inventory. */
export interface CodeQuery {
    /** Free text over the code itself and over the buyer's mobile number. */
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
    /** Every stored row, key to raw string - sealed, if it is a secret. An absent key was never set. */
    allSettings(): Promise<Map<string, string>>;

    putSetting(key: string, value: string): Promise<void>;

    logSetting(entry: SettingsLogEntry): Promise<void>;

    settingsLog(limit: number): Promise<SettingsLogEntry[]>;
}

/** Everything the application asks of the database. */
export interface Store extends SettingsStore {
    // --- The catalogue ---

    /** Every tier, ordered for display. `active: false` ones are included - the console needs them. */
    tiers(): Promise<Tier[]>;

    /**
     * The one a purchase is allowed to use: present AND active. Returns undefined otherwise,
     * which is the check that replaced the old `5 | 10 | 25` union at the boundary.
     */
    sellableTier(amount: Amount): Promise<Tier | undefined>;

    saveTier(tier: TierInput): Promise<void>;

    /**
     * Removes a tier, or deactivates it when codes or orders reference it - history must
     * keep the amount it was sold under. The return value says which happened.
     */
    removeTier(amount: Amount): Promise<TierRemoval>;

    /** True when the catalogue has never been populated, so boot can seed it once. */
    isCatalogueEmpty(): Promise<boolean>;

    // --- Inventory ---

    stock(): Promise<StockLine[]>;
    availableFor(amount: Amount): Promise<number>;
    addCodes(amount: Amount, codes: string[]): Promise<AddCodesResult>;

    /** One page of the code inventory itself: what was loaded, and where each one went. */
    searchCodes(query: CodeQuery): Promise<{ rows: CodeRow[]; total: number }>;

    // --- Orders ---

    /**
     * Reserves one free code for `orderId` and inserts the pending order, in ONE
     * transaction. Returns false when the denomination is sold out - the caller must then
     * refuse the purchase rather than send the buyer to pay for nothing.
     */
    startOrder(order: NewOrder, holdMs: number): Promise<boolean>;

    /**
     * Binds the gateway's handle to the order. False means the handle is already bound to
     * a different order - the caller must then abandon this one rather than proceed with a
     * payment it could not find on the way back.
     */
    attachAuthority(orderId: string, authority: string): Promise<boolean>;

    /** Undoes {@link Store.startOrder} when the gateway refuses to open the payment. */
    abandonOrder(orderId: string): Promise<void>;

    orderById(id: string): Promise<Order | undefined>;
    orderByAuthority(authority: string): Promise<Order | undefined>;

    /**
     * Unsettled orders whose gateway handle starts with `prefix`, opened after `since` (ISO).
     * What the NOWPayments reconciler re-checks - a crypto payment can confirm long after the buyer
     * closed the tab.
     */
    pendingOrders(prefix: string, since: string): Promise<Order[]>;

    /**
     * Keeps a NOWPayments payment id against the order's stored handle. Only ever called once
     * NOWPayments has said the payment is under that invoice. Repeating one is a no-op.
     */
    rememberPayment(authority: string, paymentId: string): Promise<void>;

    /** The payment ids kept for a handle, oldest first. */
    paymentsFor(authority: string): Promise<string[]>;

    /**
     * Settles a verified payment: keeps the held code (or claims a fresh one if the hold
     * lapsed and it was taken), and returns the code, or null for the owed state.
     */
    settlePaid(orderId: string, refId: number): Promise<string | null>;

    /** Settles an unpaid attempt and returns the held code to stock. */
    settleUnpaid(orderId: string, status: 'cancelled' | 'failed'): Promise<void>;

    markSmsDelivered(orderId: string, delivered: boolean): Promise<void>;

    /** The ledger, newest first, owed orders pinned to the top. */
    recentOrders(limit: number): Promise<Order[]>;

    /** One page of the ledger, plus how many rows the search matched in total. */
    searchOrders(query: OrderQuery): Promise<{ rows: Order[]; total: number }>;

    /** Paid orders with no code, across the WHOLE table - not just the page being shown. */
    owedCount(): Promise<number>;

    // --- Redemptions ---

    /**
     * Spends a code against a wallet address, ONCE.
     *
     * The whole double-spend guard is here: the insert is against a table keyed on the code,
     * so two simultaneous requests for one code produce one `claimed` and one `spent` no
     * matter how they interleave. A code that was never sold is `unknown` - a free code is
     * inventory the shop still owns, and redeeming one would be giving it away.
     */
    redeemCode(code: string, wallet: string, network: string): Promise<RedeemOutcome>;

    /** Records that the operator was actually told. See {@link Redemption.notified}. */
    markRedemptionNotified(code: string): Promise<void>;

    /** How many spent codes nobody has been told about. Somebody is waiting on each of these. */
    unnotifiedRedemptions(): Promise<number>;

    /** One page of the payout requests, unnotified first, then newest first. */
    searchRedemptions(query: OrderQuery): Promise<{ rows: Redemption[]; total: number }>;

    /**
     * The whole database as one SQL script, read from ONE consistent state of it - a purchase
     * committing mid-dump is either wholly in it or wholly absent. This is what the scheduled
     * Telegram backup sends. See platform/dump.ts for how it restores.
     */
    dumpSql(): Promise<string>;

    close(): Promise<void>;
}
