// One number, four ways of writing it, two scripts of digits. All of them are the same
// buyer, and the point of `normalizePhone` is that the rest of the system never has to
// know which one they typed.
import { describe, it, expect } from 'vitest';

import { displayPhone, normalizePhone, phoneField } from '../src/domain/phone.ts';

describe('normalizePhone', () =>
{
    it('accepts every shape an Iranian actually types', () =>
    {
        for (const input of ['09170459330', '9170459330', '+989170459330', '00989170459330'])
        {
            expect(normalizePhone(input)).toBe('+989170459330');
        }
    });

    it('accepts the punctuation people put in phone numbers', () =>
    {
        for (const input of ['0917 045 9330', '0917-045-9330', '(0917) 045.9330', ' 09170459330 '])
        {
            expect(normalizePhone(input)).toBe('+989170459330');
        }
    });

    it('accepts Persian and Arabic-Indic digits', () =>
    {
        // A Persian keyboard produces these. Rejecting them would be a bug wearing
        // validation's clothes.
        expect(normalizePhone('۰۹۱۷۰۴۵۹۳۳۰')).toBe('+989170459330');
        expect(normalizePhone('٠٩١٧٠٤٥٩٣٣٠')).toBe('+989170459330');
        expect(normalizePhone('+۹۸۹۱۷۰۴۵۹۳۳۰')).toBe('+989170459330');
    });

    it('refuses what is not an Iranian mobile number', () =>
    {
        for (const input of [
            '',
            '0912345',              // too short
            '091704593301',         // too long
            '02191004477',          // a Tehran landline, not a mobile
            '+14155551234',         // a different country
            '0917045933a',          // not a number
            '00989170459330000'     // the international form with junk appended
        ])
        {
            expect(normalizePhone(input)).toBeNull();
        }
    });
});

describe('displayPhone', () =>
{
    it('shows the buyer the form they recognise', () =>
    {
        expect(displayPhone('+989170459330')).toBe('09170459330');
    });
});

describe('phoneField', () =>
{
    it('passes every accepted shape and fails the rest, in Persian', () =>
    {
        expect(phoneField.safeParse('09170459330').success).toBe(true);
        expect(phoneField.safeParse('+989170459330').success).toBe(true);

        const bad = phoneField.safeParse('12345');
        expect(bad.success).toBe(false);
        // The message is what the buyer reads, so it is written for a buyer.
        expect(JSON.stringify(bad)).toContain('شماره موبایل معتبر نیست');
    });
});
