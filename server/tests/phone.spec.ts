import { describe, expect, it } from 'vitest';

import { displayPhone, normalizePhone, phoneField } from '../src/domain/phone.ts';

describe('Iranian mobile numbers', () => {
    it('normalizes domestic, international, and Persian-digit forms', () => {
        expect(normalizePhone('0912 123 4567')).toBe('+989121234567');
        expect(normalizePhone('9121234567')).toBe('+989121234567');
        expect(normalizePhone('0098-912-123-4567')).toBe('+989121234567');
        expect(normalizePhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe('+989121234567');
        expect(displayPhone('+989121234567')).toBe('09121234567');
    });

    it('rejects landlines and malformed phone numbers at the shared boundary', () => {
        expect(normalizePhone('02112345678')).toBeNull();
        expect(phoneField.safeParse('09121234567').success).toBe(true);
        expect(phoneField.safeParse('not-a-phone').success).toBe(false);
    });
});
