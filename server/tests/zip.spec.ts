// The archive the backup is mailed in, checked field by field.
//
// A ZIP WRITER THAT IS SUBTLY WRONG IS WORSE THAN NO ZIP WRITER. It produces a file that looks
// like a backup, sits in a chat for a year, and fails to open on the one day it is needed - so
// these tests do not stop at "it ran". They read the bytes back at the offsets the format
// specifies, check the CRC the writer stored against the CRC of what came out, and prove the
// payload is identical to what went in.
//
// The reader below is deliberately written from the spec rather than from ../src/platform/zip.ts,
// so a wrong offset in the writer shows up as a mismatch here instead of being cancelled out.
// It was also checked once against two independent implementations - Python's `zipfile` and
// Windows' own Expand-Archive - both of which extracted these archives with matching hashes.
import { describe, it, expect } from 'vitest';
import { crc32, inflateRawSync } from 'node:zlib';

import { zipOne } from '../src/platform/zip.ts';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Everything the local file header claims, plus the bytes it guards. */
function readEntry(archive: Buffer): {
    name: string;
    method: number;
    stored: number;
    original: number;
    bytes: Buffer;
} {
    expect(archive.readUInt32LE(0)).toBe(LOCAL_HEADER);

    const method = archive.readUInt16LE(8);
    const checksum = archive.readUInt32LE(14);
    const stored = archive.readUInt32LE(18);
    const original = archive.readUInt32LE(22);
    const nameLength = archive.readUInt16LE(26);
    const extraLength = archive.readUInt16LE(28);

    const name = archive.subarray(30, 30 + nameLength).toString('utf8');
    const start = 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + stored);
    const bytes = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);

    // The two claims the format exists to make: this many bytes, and this checksum.
    expect(bytes.byteLength).toBe(original);
    expect(crc32(bytes)).toBe(checksum);

    return { name, method, stored, original, bytes };
}

describe('the backup archive', () => {
    it('round-trips a file byte for byte', async () => {
        const body = Buffer.from('CREATE TABLE codes (id INTEGER, code TEXT);\n'.repeat(500));
        const entry = readEntry(await zipOne('guardian-service.db', body));

        expect(entry.name).toBe('guardian-service.db');
        expect(entry.bytes.equals(body)).toBe(true);
    });

    it('actually compresses - that is the whole point of the change', async () => {
        // A SQLite file is page padding and repeated SQL text. If this ratio ever collapses,
        // the archive has stopped earning the CPU it costs and somebody should know.
        const body = Buffer.from('x'.repeat(100_000));
        const entry = readEntry(await zipOne('big.db', body));

        expect(entry.method).toBe(8);
        expect(entry.stored).toBeLessThan(entry.original / 10);
    });

    it('stores rather than inflates data that will not compress', async () => {
        // Deflate makes already-compressed or very short data BIGGER. The format has a method
        // for that, and using it means the archive is never larger than the file inside it.
        const noise = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 137 + 11) % 256));
        const archive = await zipOne('noise.bin', noise);
        const entry = readEntry(archive);

        expect(entry.method).toBe(0);
        expect(entry.stored).toBe(noise.byteLength);
        expect(entry.bytes.equals(noise)).toBe(true);
    });

    it('writes a central directory a reader can find from the end', async () => {
        // Readers open a zip BACKWARDS - end record first, then the central directory it
        // points at. An archive with a good local header and a bad tail opens nowhere.
        const archive = await zipOne('one.db', Buffer.from('hello'));

        const end = archive.byteLength - 22;
        expect(archive.readUInt32LE(end)).toBe(END_OF_CENTRAL);
        expect(archive.readUInt16LE(end + 10)).toBe(1); // exactly one entry

        const size = archive.readUInt32LE(end + 12);
        const offset = archive.readUInt32LE(end + 16);
        expect(offset + size).toBe(end);
        expect(archive.readUInt32LE(offset)).toBe(CENTRAL_HEADER);

        // The central copy is the one a reader trusts, so it has to agree with the local one.
        expect(archive.readUInt32LE(offset + 16)).toBe(archive.readUInt32LE(14)); // crc
        expect(archive.readUInt32LE(offset + 20)).toBe(archive.readUInt32LE(18)); // compressed
        expect(archive.readUInt32LE(offset + 24)).toBe(archive.readUInt32LE(22)); // original
        expect(archive.readUInt32LE(offset + 42)).toBe(0); // local header is at the start
    });

    it('flags the name as UTF-8 so a non-ASCII one survives', async () => {
        const archive = await zipOne('پشتیبان.db', Buffer.from('x'));

        // Bit 11. Without it a reader may decode the name as CP437 and produce mojibake.
        expect(archive.readUInt16LE(6) & 0x0800).toBe(0x0800);
        expect(readEntry(archive).name).toBe('پشتیبان.db');
    });
});
