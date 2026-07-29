// Prints one admin key. The alphabet excludes I, O, 0 and 1 - the characters people misread
// when reading a credential aloud or copying it by hand - and the value comes from the
// platform CSPRNG, never Math.random.
//
// Modulo over a 32-character alphabet divides 256 evenly, so there is no bias to reject for.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const key = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => ALPHABET[byte % ALPHABET.length])
    .join('')
    .replace(/(.{4})(?=.)/g, '$1-');

process.stdout.write(`${ key }\n`);
