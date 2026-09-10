// Runtime configuration: the values the console may change without a deploy.
//
// READ ORDER: database first, environment as the seed. A fresh deployment still boots from
// `.env`; the moment a value is saved in the panel, that wins. `config.ts` stops being the
// last word and becomes the bootstrap.
//
// WHAT IS AND IS NOT PROTECTED, stated plainly. Values are stored as they are given. There
// is no encryption at rest, because there is nowhere to keep a key that the database file
// does not already sit beside - a key stored next to the ciphertext protects against nothing,
// and pretending otherwise is worse than being clear.
//
// So the database file is the crown jewels: unsold gift codes, which ARE money, and now the
// credentials of the account they are paid into. Back it up, keep it off any disk a redeploy
// wipes, and treat a copy of it as a copy of the business.
//
// What IS enforced here: the plaintext of a secret never crosses the API boundary outward.
// `view()` returns the last four characters and a boolean; nothing in this module returns
// more, so a stolen console session can overwrite a credential but never read one out.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { SettingsStore } from '../../db/index.ts';

/** Every key this module owns. Anything not listed is not settable from the browser. */
export const SETTING_KEYS = [
    'appName',
    'zarinpalBase',
    'merchantId',
    'smtpHost',
    'smtpPort',
    'smtpSecure',
    'smtpUser',
    'smtpPassword',
    'smtpFrom',
    'nobitexBase',
    'wallexBase',
    'marginPercent',
    'adminKeyHash'
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** The ones masked on the way out and in the audit. The rest are hosts and template names. */
const SECRETS = new Set<SettingKey>(['merchantId', 'smtpPassword', 'adminKeyHash']);

/** What the shop and the gateway client read on every call. */
export interface RuntimeSettings {
    /** What the shop calls itself: the page title, the brand, the payment description. */
    appName: string;

    zarinpalBase: string;
    merchantId: string;
    /** Where the gift-code email is handed off. Empty means delivery is off. */
    smtpHost: string;

    /** 465 for implicit TLS, 587 for STARTTLS. Anything a relay listens on. */
    smtpPort: number;

    /** True for implicit TLS on connect; false lets STARTTLS upgrade a plain connection. */
    smtpSecure: boolean;

    smtpUser: string;
    smtpPassword: string;

    /** The From address. Most relays refuse a From that is not the authenticated account. */
    smtpFrom: string;

    /** The two exchanges the tether rate is cross-checked between. See features/rate/. */
    nobitexBase: string;
    wallexBase: string;

    /**
     * The shop's markup over the tether rate, in percent. THE ONLY PROFIT DIAL: every card's
     * price is its dollar figure times the rate times this, so a typo here is a typo on every
     * card at once. That is why it is clamped on the way in and again on the way out.
     */
    marginPercent: number;
}

/** A margin beyond this is a fat finger, not a business decision. */
export const MAX_MARGIN_PERCENT = 100;

/**
 * What a value falls back to when the database has never held one.
 *
 * Only the hosts have a sensible fallback, because a provider's public API address is a fact
 * about the provider rather than a choice. Credentials start EMPTY: the shop boots, the
 * console says the gateway is not configured, and checkout refuses to start a payment until
 * somebody sets one. Booting is not the same as being open for business.
 */
const DEFAULTS = {
    appName: 'گاردین سرویس',
    zarinpalBase: 'https://payment.zarinpal.com',
    merchantId: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPassword: '',
    smtpFrom: '',
    nobitexBase: 'https://api.nobitex.ir',
    wallexBase: 'https://api.wallex.ir',
    marginPercent: 6
} as const satisfies RuntimeSettings;

export interface SettingsOptions {
    store: SettingsStore;

    /**
     * The bootstrap console credential, from `ADMIN_KEY`. It stays here rather than in the
     * database because of the obvious circularity: you cannot open the console to set the
     * key that opens the console. Once a key is rotated in, this is the break-glass path.
     */
    adminKey: string;
}

export interface Settings {
    /** The live values, read through a cache that the writer invalidates. */
    current(): RuntimeSettings;

    /** Masked, boolean, never a secret. What the console is allowed to see. */
    view(callbackUrl: string): SettingsView;

    /** Applies only the fields present; an absent field keeps its value. */
    save(changes: Partial<RuntimeSettings>): void;

    /** True when the given key matches the stored hash, or the bootstrap key if none exists. */
    matchesAdminKey(candidate: string): boolean;

    /**
     * Ensures a console credential exists. Returns a freshly generated key the FIRST time it
     * runs on an empty database - print it once, because only its hash is kept - or null when
     * one is already configured.
     */
    ensureAdminKey(): string | null;

    /** Replaces the admin key with a hash of `next`. */
    rotateAdminKey(next: string): void;

    /** True once a key has been rotated into the database. */
    adminKeyRotated(): boolean;

    log(limit: number): Array<{ key: string; before: string; after: string; changedAt: string }>;
}

/** The masked shape the console receives. Mirrors `settingsView` in the contract. */
export interface SettingsView {
    appName: string;
    zarinpalBase: string;
    sandbox: boolean;
    merchantIdMasked: string;
    merchantIdSet: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPasswordMasked: string;
    smtpPasswordSet: boolean;
    smtpFrom: string;
    nobitexBase: string;
    wallexBase: string;
    marginPercent: number;
    mailReady: boolean;
    callbackUrl: string;
    keyRotated: boolean;
}

/** @internal `••••5555`: enough to tell two credentials apart, not enough to use one. */
function mask(value: string): string {
    if (value === '') {
        return '';
    }
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/** The published shape: four groups of four over the no-I/O/0/1 alphabet (~80 bits). */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @internal A console credential from the platform CSPRNG, in the published shape. */
function mintAdminKey(): string {
    return [...randomBytes(16)]
        .map((byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length])
        .join('')
        .replace(/(.{4})(?=.)/g, '$1-');
}

/** @internal `scrypt$<salt>$<hash>`. A slow KDF costs nothing here and covers a weak key. */
function hashKey(key: string): string {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('base64')}$${scryptSync(key, salt, 32).toString('base64')}`;
}

/**
 * @internal A port that cannot break the mailer. Stored settings are text an operator typed,
 * so an empty box or a stray letter must fall back to the shipped default rather than reach
 * nodemailer as a NaN and fail every send with something unreadable.
 */
function portFrom(raw: string): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        return DEFAULTS.smtpPort;
    }
    return parsed;
}

/**
 * @internal A margin that cannot poison a price.
 *
 * The stored value is text an operator typed, so it can be empty, `'abc'`, negative, or 900.
 * None of those may reach `tomanPrice` - a NaN margin makes a NaN price and a 900% margin
 * makes a card nobody buys - so anything unreadable falls back to the shipped default rather
 * than propagating.
 */
function marginFrom(raw: string): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MARGIN_PERCENT) {
        return DEFAULTS.marginPercent;
    }
    return parsed;
}

/** @internal Constant-time comparison against a stored `scrypt$salt$hash`. */
function keyMatchesHash(candidate: string, stored: string): boolean {
    const [scheme, salt, digest] = stored.split('$');
    if (scheme !== 'scrypt' || salt === undefined || digest === undefined) {
        return false;
    }
    const expected = Buffer.from(digest, 'base64');
    const actual = scryptSync(candidate, Buffer.from(salt, 'base64'), expected.length);
    return timingSafeEqual(expected, actual);
}

export function createSettings(options: SettingsOptions): Settings {
    let cache: RuntimeSettings | null = null;

    const read = (name: SettingKey): string => options.store.getSetting(name) ?? '';

    const write = (name: SettingKey, value: string): void => {
        const before = read(name);
        if (before === value) {
            return;
        }
        options.store.putSetting(name, value);
        // The audit records MASKED values for the same reason `view` does: a log that prints
        // credentials is a second copy of them.
        options.store.logSetting({
            key: name,
            before: SECRETS.has(name) ? mask(before) : before,
            after: SECRETS.has(name) ? mask(value) : value,
            changedAt: new Date().toISOString()
        });
        cache = null;
    };

    const current = (): RuntimeSettings => {
        if (cache === null) {
            // A stored empty string means "explicitly cleared" and must not fall back to the
            // default, which is why `??` on the RAW row is wrong here: only an ABSENT row
            // takes the fallback.
            const pick = (name: SettingKey, fallback: string): string =>
                options.store.getSetting(name) === undefined ? fallback : read(name);

            cache = {
                appName: pick('appName', DEFAULTS.appName),
                zarinpalBase: pick('zarinpalBase', DEFAULTS.zarinpalBase),
                merchantId: pick('merchantId', DEFAULTS.merchantId),
                smtpHost: pick('smtpHost', DEFAULTS.smtpHost),
                smtpPort: portFrom(pick('smtpPort', String(DEFAULTS.smtpPort))),
                smtpSecure: pick('smtpSecure', String(DEFAULTS.smtpSecure)) === 'true',
                smtpUser: pick('smtpUser', DEFAULTS.smtpUser),
                smtpPassword: pick('smtpPassword', DEFAULTS.smtpPassword),
                smtpFrom: pick('smtpFrom', DEFAULTS.smtpFrom),
                nobitexBase: pick('nobitexBase', DEFAULTS.nobitexBase),
                wallexBase: pick('wallexBase', DEFAULTS.wallexBase),
                marginPercent: marginFrom(pick('marginPercent', String(DEFAULTS.marginPercent)))
            };
        }
        return cache;
    };

    return {
        current,

        view(callbackUrl) {
            const live = current();
            return {
                appName: live.appName,
                zarinpalBase: live.zarinpalBase,
                sandbox: live.zarinpalBase.includes('sandbox'),
                merchantIdMasked: mask(live.merchantId),
                merchantIdSet: live.merchantId !== '',
                smtpHost: live.smtpHost,
                smtpPort: live.smtpPort,
                smtpSecure: live.smtpSecure,
                smtpUser: live.smtpUser,
                smtpPasswordMasked: mask(live.smtpPassword),
                smtpPasswordSet: live.smtpPassword !== '',
                smtpFrom: live.smtpFrom,
                nobitexBase: live.nobitexBase,
                wallexBase: live.wallexBase,
                marginPercent: live.marginPercent,
                mailReady: live.smtpHost !== '' && live.smtpFrom !== '',
                callbackUrl,
                keyRotated: options.store.getSetting('adminKeyHash') !== undefined
            };
        },

        save(changes) {
            for (const [name, value] of Object.entries(changes)) {
                if (value !== undefined) {
                    // The margin is a number and everything else is a string; the settings
                    // table holds text either way, and `current()` converts back.
                    write(name as SettingKey, String(value));
                }
            }
        },

        matchesAdminKey(candidate) {
            const stored = read('adminKeyHash');
            if (stored === '') {
                // Nothing rotated yet: the environment key IS the credential. It stays the
                // break-glass path afterwards only if the stored hash is removed by hand.
                const expected = Buffer.from(options.adminKey);
                const actual = Buffer.from(candidate);
                return expected.length === actual.length && timingSafeEqual(expected, actual);
            }
            return keyMatchesHash(candidate, stored);
        },

        rotateAdminKey(next) {
            write('adminKeyHash', hashKey(next));
        },

        ensureAdminKey() {
            if (options.store.getSetting('adminKeyHash') !== undefined || options.adminKey !== '') {
                return null;
            }
            // A fresh install with nothing configured. The alternative - shipping a default
            // key - would publish a credential in a public repository, which is the single
            // most exploited class of mistake there is. So one is MINTED, its hash stored,
            // and the key printed once at boot for the operator to take and rotate.
            const key = mintAdminKey();
            write('adminKeyHash', hashKey(key));
            return key;
        },

        adminKeyRotated() {
            return options.store.getSetting('adminKeyHash') !== undefined;
        },

        log(limit) {
            return options.store.settingsLog(limit);
        }
    };
}
