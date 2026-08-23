// Hand-rolled JPEG marker-segment parser — see docs/designs/watermark-remover.md
// Approach C for why this isn't a third-party library. JPEG is a flat
// sequence of marker segments (0xFF + type byte + 2-byte big-endian length
// INCLUDING the length field + payload) up to SOS, then raw entropy-coded
// scan data through to EOI (copied through untouched — we never touch pixel
// data).
//
// EXIF and XMP both live in APP1 segments, distinguished by payload prefix.
// C2PA's JUMBF manifest lives in APP11 segments, sometimes split across
// several sequential APP11 segments (a manifest can exceed one segment's
// ~64KB payload cap). We never parse JUMBF's internal box structure — we
// just remove every APP11 segment encountered while scanning through to
// SOS, which strips every fragment regardless of how many there are,
// without needing to understand or reassemble the manifest.

import type { Finding } from "../watermark-finding";
import { readUint16BE, concatBytes } from "./bytes";
import { buildMinimalExifSegment, extractOrientation } from "./exif-orientation";
import { CorruptedImageError, UnsupportedFileTypeError, type ImageStripResult } from "./types";

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1;
const APP11 = 0xeb;
// Markers with no length field. RSTn (0xD0-0xD7) only ever appear inside
// scan data (after SOS), never in the pre-scan header this loop walks.
const STANDALONE = new Set([0x01, SOI, EOI]);

// Backstop against a logic error causing a stuck offset — the walk loop is
// proven to always advance (see comment above the loop), so this should
// never trip in practice. If it does, we've scanned far more segments than
// any real JPEG has and can no longer promise the rest of the file was
// checked.
const MAX_SEGMENTS = 100_000;

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/";

function isExifPayload(payload: Uint8Array): boolean {
  if (payload.length < EXIF_PREFIX.length) return false;
  for (let i = 0; i < EXIF_PREFIX.length; i++) {
    if (payload[i] !== EXIF_PREFIX[i]) return false;
  }
  return true;
}

function isXmpPayload(payload: Uint8Array): boolean {
  if (payload.length < XMP_NAMESPACE.length) return false;
  for (let i = 0; i < XMP_NAMESPACE.length; i++) {
    if (payload[i] !== XMP_NAMESPACE.charCodeAt(i)) return false;
  }
  return true;
}

export function stripJpeg(bytes: Uint8Array): ImageStripResult {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new UnsupportedFileTypeError();
  }

  const output: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let offset = 2;
  let segmentCount = 0;
  let partial = false;
  let partialReason: string | undefined;

  const counts = { exif: 0, xmp: 0, c2pa: 0 };
  let orientation: number | null = null;

  // Forward-progress proof: every branch below either throws, sets
  // offset = bytes.length (terminates the loop), or advances offset by at
  // least 2 — a length-bearing segment always advances by >= 4 since a
  // valid length is >= 2. A corrupt length under 2 throws rather than
  // stalling. This loop cannot hang.
  while (offset < bytes.length) {
    if (segmentCount++ > MAX_SEGMENTS) {
      partial = true;
      partialReason =
        "Stopped after scanning an unusually large number of segments — some signals may remain.";
      output.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }

    if (offset + 2 > bytes.length) {
      throw new CorruptedImageError("Unexpected end of file while reading a marker");
    }
    if (bytes[offset] !== 0xff) {
      throw new CorruptedImageError(`Expected a marker at offset ${offset}`);
    }

    let markerOffset = offset;
    while (markerOffset + 1 < bytes.length && bytes[markerOffset + 1] === 0xff) {
      markerOffset++;
    }
    if (markerOffset + 1 >= bytes.length) {
      throw new CorruptedImageError("Unexpected end of file while reading a marker");
    }
    const markerByte = bytes[markerOffset + 1];

    if (markerByte === SOS) {
      // Everything from here to EOF is entropy-coded scan data (plus RST
      // markers and the trailing EOI, if present) — copy through untouched.
      output.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }

    if (markerByte === EOI) {
      output.push(bytes.subarray(offset, markerOffset + 2));
      offset = markerOffset + 2;
      break;
    }

    if (STANDALONE.has(markerByte)) {
      output.push(bytes.subarray(offset, markerOffset + 2));
      offset = markerOffset + 2;
      continue;
    }

    const lengthFieldOffset = markerOffset + 2;
    if (lengthFieldOffset + 2 > bytes.length) {
      throw new CorruptedImageError("Truncated marker segment length field");
    }
    const length = readUint16BE(bytes, lengthFieldOffset);
    if (length < 2) {
      throw new CorruptedImageError(
        `Invalid segment length ${length} at offset ${lengthFieldOffset}`,
      );
    }
    const segmentEnd = lengthFieldOffset + length;
    if (segmentEnd > bytes.length) {
      throw new CorruptedImageError("Segment length exceeds remaining file size");
    }
    const payload = bytes.subarray(lengthFieldOffset + 2, segmentEnd);

    if (markerByte === APP1 && isExifPayload(payload)) {
      counts.exif++;
      if (orientation === null) orientation = extractOrientation(payload);
      // dropped
    } else if (markerByte === APP1 && isXmpPayload(payload)) {
      counts.xmp++;
      // dropped
    } else if (markerByte === APP11) {
      counts.c2pa++;
      // dropped — every APP11 segment found is removed, which strips every
      // fragment of a multi-segment JUMBF manifest without needing to
      // parse JUMBF internals (see file header comment).
    } else {
      output.push(bytes.subarray(offset, segmentEnd));
    }

    offset = segmentEnd;
  }

  if (orientation !== null) {
    output.splice(1, 0, buildMinimalExifSegment(orientation));
  }

  const findings: Finding[] = [];
  if (counts.exif > 0) {
    findings.push({
      id: "exif",
      label: "EXIF data",
      detail:
        orientation !== null
          ? `${counts.exif} segment${counts.exif === 1 ? "" : "s"} removed (orientation preserved)`
          : `${counts.exif} segment${counts.exif === 1 ? "" : "s"} removed`,
    });
  }
  if (counts.xmp > 0) {
    findings.push({
      id: "xmp",
      label: "XMP metadata",
      detail: `${counts.xmp} segment${counts.xmp === 1 ? "" : "s"} removed`,
    });
  }
  if (counts.c2pa > 0) {
    findings.push({
      id: "c2pa",
      label: "C2PA content-credentials manifest",
      detail: `${counts.c2pa} segment${counts.c2pa === 1 ? "" : "s"} removed`,
    });
  }

  return {
    format: "jpeg",
    cleaned: concatBytes(output),
    findings,
    partial,
    partialReason,
  };
}
