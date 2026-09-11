// A ZIP archive holding ONE file, written by hand.
//
// WHY NOT A LIBRARY. The only thing this repository zips is the hourly database backup, and
// the backup is the file you reach for on the worst day the shop ever has. Handing that job to
// a dependency means the archive that has to open in five years is only as durable as a
// package that may not be. What is actually needed here is one entry, deflated, no encryption,
// no zip64 - and that is a small enough slice of the format to write out in full and read.
//
// THE RISKY PART IS NOT MINE. The bytes are compressed by `zlib.deflateRaw` and checksummed
// by `zlib.crc32`, both built into Node; what this file contributes is the envelope around
// them - three fixed-layout records described in PKWARE's APPNOTE.TXT and unchanged since the
// 1990s. Every offset below is annotated with the field it writes, because a byte in the wrong
// place here produces an archive that looks fine until somebody needs it.
//
// IT IS ASYNC FOR ONE REASON: this runs in the same process that takes payments. Deflating a
// multi-megabyte database at level 9 is tens of milliseconds of solid CPU at best, and
// `deflateRawSync` would spend every one of them with the event loop stopped - a checkout in
// flight would simply wait. The callback form does the same work on the thread pool.
//
// WHAT IT DELIBERATELY DOES NOT DO: multiple entries, directories, zip64 (so, nothing at or
// past 4GB), encryption, or streaming. A backup that grows past 4GB has outgrown being mailed
// through a chat bot long before it outgrows this.
import { promisify } from 'node:util';
import { constants, crc32, deflateRaw } from 'node:zlib';

const deflate = promisify(deflateRaw);

/** Stored, not compressed. Used when deflating would make the entry bigger. */
const METHOD_STORE = 0;

/** Deflate, which is what the rest of the world means by "a zip". */
const METHOD_DEFLATE = 8;

/** The version that understands deflate: 2.0, written as 20. */
const VERSION = 20;

/**
 * Bit 11 of the general-purpose flags: the filename is UTF-8.
 *
 * Without it a reader is entitled to decode the name as IBM Code Page 437, which turns any
 * non-ASCII character into mojibake. The names this repository writes are ASCII today; the
 * flag costs two bytes and means that stays true if one ever is not.
 */
const FLAG_UTF8 = 0x0800;

/** Past this a field needs zip64, which this writer does not do. */
const MAX_ENTRY_BYTES = 0xffff_ffff;

/**
 * One file, in a zip.
 *
 * @param name  The entry's name INSIDE the archive - what the operator sees after opening it.
 * @param bytes The file's contents.
 * @param at    The timestamp recorded on the entry. Defaults to now.
 */
export async function zipOne(
    name: string,
    bytes: Uint8Array,
    at: Date = new Date()
): Promise<Buffer> {
    const filename = Buffer.from(name, 'utf8');
    if (bytes.byteLength > MAX_ENTRY_BYTES) {
        throw new Error('zipOne cannot write an entry of 4GB or more');
    }

    // Level 9. The caller is trading CPU on a background timer against bytes on somebody
    // else's network, and the CPU is the cheaper of the two by a wide margin.
    const deflated = await deflate(bytes, { level: constants.Z_BEST_COMPRESSION });

    // Deflate can enlarge data that is already compressed or too small to model. The format
    // has a method for exactly that, and using it means this never returns an archive bigger
    // than the file it was given.
    const compressible = deflated.byteLength < bytes.byteLength;
    const method = compressible ? METHOD_DEFLATE : METHOD_STORE;
    const payload = compressible ? deflated : Buffer.from(bytes);

    const checksum = crc32(bytes);
    const { time, date } = dosStamp(at);

    // --- Local file header, immediately followed by the data itself ---
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(VERSION, 4); // version needed to extract
    local.writeUInt16LE(FLAG_UTF8, 6); // general purpose flags
    local.writeUInt16LE(method, 8); // compression method
    local.writeUInt16LE(time, 10); // last modified time
    local.writeUInt16LE(date, 12); // last modified date
    local.writeUInt32LE(checksum, 14); // crc-32 of the UNCOMPRESSED bytes
    local.writeUInt32LE(payload.byteLength, 18); // compressed size
    local.writeUInt32LE(bytes.byteLength, 22); // uncompressed size
    local.writeUInt16LE(filename.byteLength, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length

    // --- Central directory: the same facts again, plus where the local header started ---
    // A reader opens a zip from the END, so this copy is the one that is actually trusted.
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed to extract
    central.writeUInt16LE(FLAG_UTF8, 8); // general purpose flags
    central.writeUInt16LE(method, 10); // compression method
    central.writeUInt16LE(time, 12); // last modified time
    central.writeUInt16LE(date, 14); // last modified date
    central.writeUInt32LE(checksum, 16); // crc-32
    central.writeUInt32LE(payload.byteLength, 20); // compressed size
    central.writeUInt32LE(bytes.byteLength, 24); // uncompressed size
    central.writeUInt16LE(filename.byteLength, 28); // file name length
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number where the file starts
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(0, 42); // offset of the local header - the only entry, so zero

    const centralSize = central.byteLength + filename.byteLength;
    const centralOffset = local.byteLength + filename.byteLength + payload.byteLength;

    // --- End of central directory: the 22 bytes a reader looks for first ---
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // signature
    end.writeUInt16LE(0, 4); // this disk's number
    end.writeUInt16LE(0, 6); // disk holding the central directory
    end.writeUInt16LE(1, 8); // entries on this disk
    end.writeUInt16LE(1, 10); // entries in total
    end.writeUInt32LE(centralSize, 12); // size of the central directory
    end.writeUInt32LE(centralOffset, 16); // where the central directory starts
    end.writeUInt16LE(0, 20); // archive comment length

    return Buffer.concat([local, filename, payload, central, filename, end]);
}

/**
 * @internal A timestamp in the shape MS-DOS used in 1980, which is the shape zip still wants.
 *
 * Seconds have one bit less than they need, so they land on even numbers; that is the format,
 * not a rounding bug here. Dates before 1980 cannot be represented at all and are clamped
 * rather than written as a negative year that some readers show as 2107.
 */
function dosStamp(at: Date): { time: number; date: number } {
    const year = Math.max(at.getFullYear(), 1980);
    return {
        time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()
    };
}
