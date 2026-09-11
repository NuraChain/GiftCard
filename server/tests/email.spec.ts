// The address rule, and the message it ends up in.
//
// These replace phone.spec.ts. The shapes being defended against are different - an address
// cannot be typed four ways, but it CAN carry characters that are completely invisible - and
// that second class is the reason this file is longer than a regex test has any right to be.
import { describe, it, expect } from 'vitest';

import { displayEmail, emailField, normalizeEmail } from '../src/domain/email.ts';
import {
    composeCodeMail,
    createMailer,
    type MailSettings
} from '../src/features/checkout/mailer.ts';

describe('an email address', () => {
    it('accepts the ordinary shapes people actually type', () => {
        expect(normalizeEmail('ali@example.com')).toBe('ali@example.com');
        expect(normalizeEmail('ali.reza+giftcard@mail.example.co.uk')).toBe(
            'ali.reza+giftcard@mail.example.co.uk'
        );
        expect(normalizeEmail('a_b-c@sub.domain.ir')).toBe('a_b-c@sub.domain.ir');
    });

    it('trims and lowercases to ONE stored form', () => {
        // The console searches the ledger by address. Two spellings of the same account would
        // mean an operator on a support call fails to find the order in front of them.
        expect(normalizeEmail('  Ali.Reza@Example.COM  ')).toBe('ali.reza@example.com');
        expect(normalizeEmail('ALI@EXAMPLE.COM')).toBe(normalizeEmail('ali@example.com'));
    });

    it('converts Persian and Arabic-Indic digits before validating', () => {
        // A Persian keyboard types these by default. Rejecting them would be a bug wearing
        // validation's clothes - the same argument the phone module made.
        expect(normalizeEmail('ali۱۲۳@example.com')).toBe('ali123@example.com');
        expect(normalizeEmail('ali٤٥٦@example.com')).toBe('ali456@example.com');
    });

    it('strips the invisible characters Persian typing leaves behind', () => {
        // THE WORST FAILURE THIS MODULE PREVENTS. A zero-width non-joiner renders as nothing,
        // so the buyer proof-reads an address that looks perfectly correct, pays, and the
        // code goes to an address that does not exist. Nobody finds out until support does.
        expect(normalizeEmail('ali‌@example.com')).toBe('ali@example.com');
        expect(normalizeEmail('‪ali@example.com‬')).toBe('ali@example.com');
        expect(normalizeEmail('﻿ali@example.com')).toBe('ali@example.com');
    });

    it('refuses what is not a deliverable address', () => {
        expect(normalizeEmail('')).toBeNull();
        expect(normalizeEmail('ali')).toBeNull();
        expect(normalizeEmail('ali@')).toBeNull();
        expect(normalizeEmail('@example.com')).toBeNull();
        // No dot in the domain: `ali@gmail` is a half-typed address far more often than it is
        // an intranet host, and this shop does not sell to intranets.
        expect(normalizeEmail('ali@example')).toBeNull();
        expect(normalizeEmail('ali example@test.com')).toBeNull();
        expect(normalizeEmail('ali@@example.com')).toBeNull();
        expect(normalizeEmail('ali@example..com')).toBeNull();
    });

    it('refuses an address longer than anything will deliver to', () => {
        expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
    });

    it('shows back exactly what is stored', () => {
        // Unlike a phone number, the canonical form IS the readable form.
        expect(displayEmail('ali@example.com')).toBe('ali@example.com');
    });

    it('is the SAME rule on both sides of the wire', () => {
        // The browser form and the server boundary share this field, which is the whole
        // reason it lives in a client-safe module.
        expect(emailField.safeParse('ali@example.com').success).toBe(true);
        expect(emailField.safeParse('nope').success).toBe(false);
        expect(emailField.safeParse('  ali@example.com  ').success).toBe(true);
    });
});

const SETTINGS: MailSettings = {
    apiKey: 're_test_key',
    from: 'shop@test',
    baseUrl: 'https://resend.test',
    appName: 'گاردین سرویس'
};

describe('the gift-code email', () => {
    it('puts the code on a line of its own in the plain-text part', () => {
        const mail = composeCodeMail(SETTINGS, 'ali@example.com', 'NC-1234-5678', 10);

        // A double-click has to select the code and nothing else, in a client with styling
        // off. That is what the bare line is for.
        expect(mail.text.split('\n')).toContain('NC-1234-5678');
        expect(mail.to).toBe('ali@example.com');
        expect(mail.subject).toContain('10');
        expect(mail.subject).toContain('گاردین سرویس');
    });

    it('isolates the code so RTL text cannot reorder it', () => {
        const mail = composeCodeMail(SETTINGS, 'ali@example.com', 'NC-1234-5678', 10);
        // Without dir="ltr" the Latin run reorders against the Persian around it and the
        // buyer copies a code that is not the one they were sent.
        expect(mail.html).toContain('dir="ltr"');
        expect(mail.html).toContain('NC-1234-5678');
    });

    it('escapes what it interpolates', () => {
        const mail = composeCodeMail(
            { ...SETTINGS, appName: 'Shop <b>&' },
            'ali@example.com',
            'a<b>&"c',
            5
        );
        expect(mail.html).toContain('a&lt;b&gt;&amp;&quot;c');
        expect(mail.html).toContain('Shop &lt;b&gt;&amp;');
        expect(mail.html).not.toContain('<b>&');
    });
});

// The Resend client. `fetch` is injected, so a 401, a rejected domain, a timeout and a happy
// path all run here with no account and no network.
/** Records the one request the mailer makes, and answers with whatever the test wants. */
function spyFetch(answer: { status: number; body?: unknown }): {
    calls: Array<{ url: string; init: RequestInit }>;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
} {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    return {
        calls,
        fetch: (url, init) => {
            calls.push({ url, init: init ?? {} });
            return Promise.resolve(
                new Response(JSON.stringify(answer.body ?? {}), {
                    status: answer.status,
                    headers: { 'content-type': 'application/json' }
                })
            );
        }
    };
}

describe('sending through Resend', () => {
    it('posts the composed message to the configured host with the key', async () => {
        const spy = spyFetch({ status: 200, body: { id: 'abc-123' } });
        const mailer = createMailer({ settings: () => SETTINGS, fetch: spy.fetch });

        expect(await mailer.sendCode('ali@example.com', 'NC-1234-5678', 10)).toEqual({ ok: true });

        expect(spy.calls).toHaveLength(1);
        // The HOST comes from settings, not from a constant - that is what lets an operator
        // behind a blocked network point this at a relay without a deploy.
        expect(spy.calls[0].url).toBe('https://resend.test/emails');

        const headers = spy.calls[0].init.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer re_test_key');

        const body = JSON.parse(String(spy.calls[0].init.body)) as Record<string, string>;
        expect(body.from).toBe('shop@test');
        expect(body.to).toBe('ali@example.com');
        // Both parts travel. The text one is what survives a client with styling off, which
        // for a message whose entire payload is one code is the part that matters.
        expect(body.text).toContain('NC-1234-5678');
        expect(body.html).toContain('NC-1234-5678');
    });

    it("hands the operator Resend's own words when it refuses", async () => {
        // The two refusals that actually happen: an unverified domain, and the sandbox sender
        // that only reaches the account owner. Neither is guessable from a status code, so the
        // provider's `message` is passed through rather than replaced with something tidy.
        const spy = spyFetch({
            status: 403,
            body: { name: 'validation_error', message: 'The example.com domain is not verified.' }
        });
        const mailer = createMailer({ settings: () => SETTINGS, fetch: spy.fetch });

        expect(await mailer.sendCode('ali@example.com', 'NC-1', 10)).toEqual({
            ok: false,
            reason: 'The example.com domain is not verified.'
        });
    });

    it('still reports a reason when the refusal has no body', async () => {
        const spy = spyFetch({ status: 502, body: null });
        const mailer = createMailer({ settings: () => SETTINGS, fetch: spy.fetch });

        const result = await mailer.sendCode('ali@example.com', 'NC-1', 10);
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toContain('502');
    });

    it('refuses without calling out when nothing is configured', async () => {
        // A code is valid whether or not the message arrives, so an unconfigured mailer
        // degrades to exactly what an outage produces - a notice, never a failed purchase.
        const spy = spyFetch({ status: 200 });
        const mailer = createMailer({
            settings: () => ({ ...SETTINGS, apiKey: '' }),
            fetch: spy.fetch
        });

        expect(await mailer.sendCode('ali@example.com', 'NC-1', 10)).toEqual({
            ok: false,
            reason: 'email delivery is not configured'
        });
        expect(spy.calls).toHaveLength(0);
    });

    it('reports a thrown transport failure rather than escaping it', async () => {
        const mailer = createMailer({
            settings: () => SETTINGS,
            fetch: () => Promise.reject(new Error('network unreachable'))
        });

        expect(await mailer.sendCode('ali@example.com', 'NC-1', 10)).toEqual({
            ok: false,
            reason: 'network unreachable'
        });
    });
});
