import { z } from 'zod';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toAsciiDigits(input: string): string {
    let out = '';
    for (const character of input) {
        const persian = PERSIAN_DIGITS.indexOf(character);
        const arabic = ARABIC_DIGITS.indexOf(character);
        if (persian !== -1) {
            out += String(persian);
        } else if (arabic !== -1) {
            out += String(arabic);
        } else if (!/[\s\-.()]/.test(character)) {
            out += character;
        }
    }
    return out;
}

export function normalizePhone(input: string): string | null {
    const digits = toAsciiDigits(input.trim());
    let national: string;
    if (digits.startsWith('+98')) {
        national = digits.slice(3);
    } else if (digits.startsWith('0098')) {
        national = digits.slice(4);
    } else if (digits.startsWith('98') && digits.length === 12) {
        national = digits.slice(2);
    } else if (digits.startsWith('0')) {
        national = digits.slice(1);
    } else {
        national = digits;
    }

    return /^9\d{9}$/.test(national) ? `+98${national}` : null;
}

export function phoneSearchVariants(input: string): string[] {
    const compact = toAsciiDigits(input.trim());
    const variants = [compact];
    if (compact.startsWith('0098')) {
        variants.push(`+98${compact.slice(4)}`);
    } else if (compact.startsWith('0')) {
        variants.push(`+98${compact.slice(1)}`);
    } else if (compact.startsWith('98') && compact.length <= 12) {
        variants.push(`+${compact}`);
    } else if (compact.startsWith('9')) {
        variants.push(`+98${compact}`);
    }
    return [...new Set(variants)];
}

export function displayPhone(canonical: string): string {
    return canonical.startsWith('+98') ? `0${canonical.slice(3)}` : canonical;
}

export const phoneField: z.ZodType<string> = z
    .string()
    .trim()
    .max(20, { message: 'شماره موبایل معتبر نیست' })
    .refine((value) => normalizePhone(value) !== null, {
        message: 'شماره موبایل معتبر نیست'
    });
