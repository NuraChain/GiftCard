// The inventory's wire shapes: codes come in, codes go out.
//
// CLIENT-SAFE. Like every features/*/schemas.ts, this may import only `@azerothjs/schema`
// and `domain/`.
import { array, literal, number, object, string, union, type Infer } from '@azerothjs/schema';

import { amountField, amountQueryField } from '../../domain/amount.ts';

/**
 * One code in the inventory, and where it went. This is the audit view: what was loaded,
 * what is still sellable, and which buyer holds which code.
 */
export const codeRow = object({
    code: string(),
    amount: amountField,
    state: union([literal('free'), literal('held'), literal('sold')]),
    addedAt: string(),
    phone: string().nullable(),
    soldAt: string().nullable(),
    refId: number({ int: true }).nullable()
});

export const codeQuery = object({
    search: string({ trim: true, max: 64 }).optional(),
    state: union([literal('free'), literal('held'), literal('sold')]).optional(),
    amount: amountQueryField.optional(),
    page: number({ int: true, min: 1, coerce: true }).optional()
});

export const codePage = object({
    rows: array(codeRow),
    total: number({ int: true }),
    page: number({ int: true }),
    pageSize: number({ int: true })
});

export const addCodesInput = object({
    amount: amountField,
    codes: array(string({ trim: true, max: 64 }), { max: 500 })
});

/** Every pasted line is accounted for; `invalid` returns the bad ones verbatim to be fixed. */
export const addCodesResult = object({
    added: number({ int: true }),
    duplicate: number({ int: true }),
    invalid: array(string())
});

export type CodePage = Infer<typeof codePage>;
export type CodeRow = Infer<typeof codeRow>;
export type AddCodesResult = Infer<typeof addCodesResult>;
