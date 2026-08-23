// EXIF orientation is the one tag the parser must NOT wholesale-delete along
// with the rest of the EXIF data (see docs/designs/watermark-remover.md,
// "Orientation exception", added after mockup review surfaced that stripping
// it would rotate users' photos). Everything else in EXIF (GPS, camera
// model/serial, software, etc.) is deliberately dropped. Applies to both
// JPEG's APP1 EXIF segment (payload prefixed "Exif\0\0") and PNG's `eXIf`
// chunk (raw TIFF, no prefix) — same TIFF/IFD core, different wrapper.
//
// EXIF/TIFF: 2-byte byte-order mark ("II" little-endian / "MM" big-endian),
// 2-byte magic (42), 4-byte offset to IFD0 (relative to the TIFF header
// start). An IFD is a 2-byte entry count, N * 12-byte entries, then a
// 4-byte offset to the next IFD. Each entry: 2-byte tag, 2-byte type,
// 4-byte count, 4-byte value (or offset, if the value doesn't fit in 4
// bytes) — a SHORT with count 1 always fits inline, left-justified in
// those 4 bytes.
//
// Fail-soft by design: any malformed/unexpected structure returns null
// rather than throwing. Safer to strip everything (including orientation)
// on a payload we can't confidently parse than to guess.

import { readUint16BE, readUint32BE } from "./bytes";

const ORIENTATION_TAG = 0x0112;
const TYPE_SHORT = 3;
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function readUint16(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : readUint16BE(bytes, offset);
}

function readUint32(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
        0
    : readUint32BE(bytes, offset);
}

function extractOrientationAt(bytes: Uint8Array, tiffBase: number): number | null {
  try {
    if (tiffBase + 8 > bytes.length) return null;
    const byteOrderMark = readUint16BE(bytes, tiffBase);
    let little: boolean;
    if (byteOrderMark === 0x4949) little = true;
    else if (byteOrderMark === 0x4d4d) little = false;
    else return null;

    const magic = readUint16(bytes, tiffBase + 2, little);
    if (magic !== 42) return null;

    const ifd0Offset = readUint32(bytes, tiffBase + 4, little);
    const ifdStart = tiffBase + ifd0Offset;
    if (ifdStart < 0 || ifdStart + 2 > bytes.length) return null;

    const entryCount = readUint16(bytes, ifdStart, little);
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      if (entryOffset + 12 > bytes.length) break;
      const tag = readUint16(bytes, entryOffset, little);
      if (tag === ORIENTATION_TAG) {
        const type = readUint16(bytes, entryOffset + 2, little);
        if (type !== TYPE_SHORT) return null;
        const value = readUint16(bytes, entryOffset + 8, little);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// JPEG: APP1 payload starts with "Exif\0\0" before the TIFF blob.
export function extractOrientation(exifPayload: Uint8Array): number | null {
  if (exifPayload.length < EXIF_PREFIX.length) return null;
  for (let i = 0; i < EXIF_PREFIX.length; i++) {
    if (exifPayload[i] !== EXIF_PREFIX[i]) return null;
  }
  return extractOrientationAt(exifPayload, EXIF_PREFIX.length);
}

// PNG: the `eXIf` chunk's data IS the raw TIFF blob, no "Exif\0\0" prefix.
export function extractOrientationFromRawTiff(tiffBytes: Uint8Array): number | null {
  return extractOrientationAt(tiffBytes, 0);
}

// A minimal, complete TIFF/IFD0 blob carrying only the orientation tag.
// Little-endian by construction — an arbitrary, consistent choice. 26 bytes.
function buildMinimalTiff(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff.set([0x49, 0x49], 0); // "II"
  tiff.set([0x2a, 0x00], 2); // magic 42
  tiff.set([0x08, 0x00, 0x00, 0x00], 4); // IFD0 offset = 8
  tiff.set([0x01, 0x00], 8); // entry count = 1
  tiff.set([0x12, 0x01], 10); // tag 0x0112
  tiff.set([0x03, 0x00], 12); // type SHORT
  tiff.set([0x01, 0x00, 0x00, 0x00], 14); // count = 1
  tiff.set([orientation & 0xff, 0x00, 0x00, 0x00], 18); // value
  tiff.set([0x00, 0x00, 0x00, 0x00], 22); // next IFD offset = 0
  return tiff;
}

// PNG: the eXIf chunk data is exactly this — no prefix, no marker wrapper.
export function buildMinimalTiffOrientation(orientation: number): Uint8Array {
  return buildMinimalTiff(orientation);
}

// JPEG: a complete APP1 marker segment (marker + length + "Exif\0\0" + TIFF).
export function buildMinimalExifSegment(orientation: number): Uint8Array {
  const tiff = buildMinimalTiff(orientation);
  const segment = new Uint8Array(4 + EXIF_PREFIX.length + tiff.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  const length = 2 + EXIF_PREFIX.length + tiff.length;
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(EXIF_PREFIX, 4);
  segment.set(tiff, 4 + EXIF_PREFIX.length);
  return segment;
}
