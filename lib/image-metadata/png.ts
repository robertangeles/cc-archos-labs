// Hand-rolled PNG chunk parser — see docs/designs/watermark-remover.md
// Approach C. PNG is a flat sequence of chunks (4-byte data length + 4-byte
// type + data + 4-byte CRC32 over type+data) after an 8-byte signature.
// EXIF lives in the `eXIf` chunk (PNG spec since 2017, raw TIFF, no
// "Exif\0\0" prefix unlike JPEG); XMP lives in an `iTXt` chunk keyed
// exactly "XML:com.adobe.xmp"; C2PA's JUMBF lives in a `caBX` chunk.
//
// Unlike JPEG, PNG gives every chunk a CRC32 for free — used here as the
// primary corruption check (a mismatch proves the file, or our parse of
// it, is wrong) rather than trusting length fields alone.

import type { Finding } from "../watermark-finding";
import { readUint32BE, crc32, concatBytes } from "./bytes";
import {
  buildMinimalTiffOrientation,
  extractOrientationFromRawTiff,
} from "./exif-orientation";
import { CorruptedImageError, UnsupportedFileTypeError, type ImageStripResult } from "./types";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_CHUNKS = 100_000;
const XMP_KEYWORD = "XML:com.adobe.xmp";

function typeToString(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readNullTerminatedAscii(data: Uint8Array, maxLen: number): string | null {
  const limit = Math.min(data.length, maxLen + 1);
  for (let i = 0; i < limit; i++) {
    if (data[i] === 0) {
      let s = "";
      for (let j = 0; j < i; j++) s += String.fromCharCode(data[j]);
      return s;
    }
  }
  return null;
}

function isXmpITXt(data: Uint8Array): boolean {
  // iTXt: Keyword\0 CompressionFlag CompressionMethod LanguageTag\0 ...
  const keyword = readNullTerminatedAscii(data, 79);
  return keyword === XMP_KEYWORD;
}

function buildEXifChunk(orientation: number): Uint8Array {
  const data = buildMinimalTiffOrientation(orientation);
  const type = new Uint8Array([0x65, 0x58, 0x49, 0x66]); // "eXIf"
  const length = new Uint8Array(4);
  length[0] = (data.length >>> 24) & 0xff;
  length[1] = (data.length >>> 16) & 0xff;
  length[2] = (data.length >>> 8) & 0xff;
  length[3] = data.length & 0xff;
  const crcInput = concatBytes([type, data]);
  const crc = crc32(crcInput);
  const crcBytes = new Uint8Array([
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ]);
  return concatBytes([length, type, data, crcBytes]);
}

export function stripPng(bytes: Uint8Array): ImageStripResult {
  if (bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new UnsupportedFileTypeError();
  }

  const output: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let chunkCount = 0;
  let partial = false;
  let partialReason: string | undefined;

  const counts = { exif: 0, xmp: 0, c2pa: 0 };
  let orientation: number | null = null;
  let sawIend = false;

  // Forward-progress proof: every branch throws, sets offset = bytes.length
  // (terminates the loop), or advances offset by at least 12 (the minimum
  // chunk overhead: 4 length + 4 type + 4 CRC, even with zero-length data).
  while (offset < bytes.length) {
    if (chunkCount++ > MAX_CHUNKS) {
      partial = true;
      partialReason =
        "Stopped after scanning an unusually large number of chunks — some signals may remain.";
      output.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }

    if (offset + 8 > bytes.length) {
      throw new CorruptedImageError("Truncated file while reading a chunk header");
    }
    const dataLength = readUint32BE(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + dataLength;
    const crcStart = dataEnd;
    const crcEnd = crcStart + 4;
    if (crcEnd > bytes.length) {
      throw new CorruptedImageError("Chunk length exceeds remaining file size");
    }

    const type = typeToString(bytes, typeStart);
    const chunkForCrc = bytes.subarray(typeStart, dataEnd);
    const expectedCrc = readUint32BE(bytes, crcStart);
    const actualCrc = crc32(chunkForCrc);
    if (actualCrc !== expectedCrc) {
      throw new CorruptedImageError(`CRC mismatch on chunk "${type}" — file may be corrupted`);
    }

    const data = bytes.subarray(dataStart, dataEnd);

    if (type === "eXIf") {
      counts.exif++;
      if (orientation === null) orientation = extractOrientationFromRawTiff(data);
      // dropped
    } else if (type === "iTXt" && isXmpITXt(data)) {
      counts.xmp++;
      // dropped
    } else if (type === "caBX") {
      counts.c2pa++;
      // dropped — every caBX chunk found is removed, covering a manifest
      // split across multiple chunks the same way the JPEG parser handles
      // multi-segment C2PA/JUMBF (see lib/image-metadata/jpeg.ts).
    } else {
      output.push(bytes.subarray(offset, crcEnd));
    }

    if (type === "IEND") {
      sawIend = true;
      offset = crcEnd;
      break;
    }

    offset = crcEnd;
  }

  if (!sawIend && !partial) {
    throw new CorruptedImageError("File ended without an IEND chunk");
  }

  if (orientation !== null) {
    output.splice(1, 0, buildEXifChunk(orientation));
  }

  const findings: Finding[] = [];
  if (counts.exif > 0) {
    findings.push({
      id: "exif",
      label: "EXIF data",
      detail:
        orientation !== null
          ? `${counts.exif} chunk${counts.exif === 1 ? "" : "s"} removed (orientation preserved)`
          : `${counts.exif} chunk${counts.exif === 1 ? "" : "s"} removed`,
    });
  }
  if (counts.xmp > 0) {
    findings.push({
      id: "xmp",
      label: "XMP metadata",
      detail: `${counts.xmp} chunk${counts.xmp === 1 ? "" : "s"} removed`,
    });
  }
  if (counts.c2pa > 0) {
    findings.push({
      id: "c2pa",
      label: "C2PA content-credentials manifest",
      detail: `${counts.c2pa} chunk${counts.c2pa === 1 ? "" : "s"} removed`,
    });
  }

  return {
    format: "png",
    cleaned: concatBytes(output),
    findings,
    partial,
    partialReason,
  };
}
