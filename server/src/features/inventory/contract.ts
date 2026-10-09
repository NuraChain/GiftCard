// The inventory's wire shapes and routes: codes come in, codes go out.
//
// CLIENT-SAFE. Like every features/*/contract.ts, this may import only
// `platform/contract.ts`, `zod` and `domain/`.
import { z } from 'zod';

import { get, post } from '../../platform/contract.ts';
import { amountField, amountQueryField } from '../../contract/shared.ts';

/**
 * One code in the inventory, and where it went. This is the audit view: what was loaded,
 * what is still sellable, and which buyer holds which code.
 */
export const codeRow = z.object({
    code: z.string(),
    amount: amountField,
    state: z.enum(['free', 'held', 'sold']),
    addedAt: z.string(),
    phone: z.string().nullable(),
    soldAt: z.string().nullable(),
    refId: z.number().int().nullable()
});

export const codeQuery = z.object({
    search: z.string().trim().max(64).optional(),
    state: z.enum(['free', 'held', 'sold']).optional(),
    amount: amountQueryField.optional(),
    page: z.coerce.number().int().min(1).optional()
});

export const codePage = z.object({
    rows: z.array(codeRow),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int()
});

export const addCodesInput = z.object({
    amount: amountField,
    codes: z.array(z.string().trim().max(64)).max(500)
});

/** Every pasted line is accounted for; `invalid` returns the bad ones verbatim to be fixed. */
export const addCodesResult = z.object({
    added: z.number().int(),
    duplicate: z.number().int(),
    invalid: z.array(z.string())
});

export type CodePage = z.infer<typeof codePage>;
export type CodeRow = z.infer<typeof codeRow>;
export type AddCodesResult = z.infer<typeof addCodesResult>;

/** The inventory's routes. They join the `admin` group in ../../contract/index.ts. */
export const inventoryRoutes = {
    addCodes: post('/admin/codes', { input: addCodesInput, output: addCodesResult }),
    codes: get('/admin/codes', { query: codeQuery, output: codePage })
};
