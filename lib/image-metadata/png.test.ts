import { describe, expect, it } from "vitest";
import { crc32 } from "./bytes";
import {
  buildMinimalTiffOrientation,
  extractOrientationFromRawTiff,
} from "./exif-orientation";
import { CorruptedImageError, UnsupportedFileTypeError } from "./types";
import { stripPng } from "./png";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const length = data.length;
  const lengthBytes = [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ];
  const crc = crc32(new Uint8Array([...typeBytes, ...data]));
  const crcBytes = [
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
  return [...lengthBytes, ...typeBytes, ...data, ...crcBytes];
}

const IHDR = chunk("IHDR", [
  0x00, 0x00, 0x00, 0x01, // width = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
]);
const IDAT = chunk("IDAT", [0x00, 0x01, 0x02, 0x03]); // fake, parser never inspects it
const IEND = chunk("IEND", []);

function keywordChunk(keyword: string, text: number[] = []): number[] {
  const kw = [...keyword].map((c) => c.charCodeAt(0));
  const compressionFlag = 0x00;
  const compressionMethod = 0x00;
  const langTagNull = 0x00;
  const translatedKeywordNull = 0x00;
  return chunk("iTXt", [
    ...kw,
    0x00, // keyword null terminator
    compressionFlag,
    compressionMethod,
    langTagNull,
    translatedKeywordNull,
    ...text,
  ]);
}

function caBX(fill: number): number[] {
  return chunk("caBX", [0x4a, 0x50, fill, fill]); // arbitrary JUMBF-ish payload
}

function png(...parts: number[][]): Uint8Array {
  return new Uint8Array([...SIGNATURE, ...parts.flat()]);
}

describe("stripPng", () => {
  it("rejects non-PNG magic bytes", () => {
    expect(() => stripPng(new Uint8Array([0xff, 0xd8, 0xff]))).toThrow(
      UnsupportedFileTypeError,
    );
  });

  it("strips eXIf and preserves orientation via a minimal synthetic chunk", () => {
    const tiff = Array.from(buildMinimalTiffOrientation(6));
    const eXIf = chunk("eXIf", tiff);
    const bytes = png(IHDR, IDAT, eXIf, IEND);
    const result = stripPng(bytes);

    expect(result.format).toBe("png");
    expect(result.partial).toBe(false);
    expect(result.findings).toEqual([
      { id: "exif", label: "EXIF data", detail: "1 chunk removed (orientation preserved)" },
    ]);

    const exifData = findChunk(result.cleaned, "eXIf");
    expect(exifData).not.toBeNull();
    expect(extractOrientationFromRawTiff(exifData!)).toBe(6);
  });

  it("strips only the XMP-keyed iTXt chunk, leaving other iTXt chunks untouched", () => {
    const xmpChunk = keywordChunk("XML:com.adobe.xmp", [0x3c, 0x3f, 0x78]);
    const titleChunk = keywordChunk("Title", [0x4d, 0x79, 0x20, 0x50, 0x68, 0x6f, 0x74, 0x6f]); // "My Photo"
    const bytes = png(IHDR, IDAT, xmpChunk, titleChunk, IEND);
    const result = stripPng(bytes);

    expect(result.findings).toEqual([
      { id: "xmp", label: "XMP metadata", detail: "1 chunk removed" },
    ]);
    expect(findChunk(result.cleaned, "iTXt")).not.toBeNull(); // Title survives
    expect(countChunks(result.cleaned, "iTXt")).toBe(1);
  });

  it("removes every caBX chunk across a multi-chunk C2PA manifest", () => {
    const bytes = png(IHDR, IDAT, caBX(0x01), caBX(0x02), IEND);
    const result = stripPng(bytes);
    expect(result.findings).toEqual([
      {
        id: "c2pa",
        label: "C2PA content-credentials manifest",
        detail: "2 chunks removed",
      },
    ]);
    expect(countChunks(result.cleaned, "caBX")).toBe(0);
  });

  it("reports zero findings for a clean PNG and passes it through unchanged", () => {
    const bytes = png(IHDR, IDAT, IEND);
    const result = stripPng(bytes);
    expect(result.findings).toEqual([]);
    expect(result.partial).toBe(false);
    expect(Array.from(result.cleaned)).toEqual(Array.from(bytes));
  });

  it("throws a typed error on CRC mismatch (corrupted chunk)", () => {
    const bytes = png(IHDR, IDAT, IEND);
    const corrupted = new Uint8Array(bytes);
    // Flip a byte inside IHDR's data (well past the signature+length+type).
    corrupted[8 + 4 + 4 + 4] ^= 0xff;
    expect(() => stripPng(corrupted)).toThrow(CorruptedImageError);
  });

  it("throws a typed error when the file ends without an IEND chunk", () => {
    const bytes = png(IHDR, IDAT); // no IEND
    expect(() => stripPng(bytes)).toThrow(CorruptedImageError);
  });

  it("throws a typed error on a truncated chunk header", () => {
    const bytes = png(IHDR).slice(0, SIGNATURE.length + 8 + 5); // cut mid-IHDR
    expect(() => stripPng(new Uint8Array(bytes))).toThrow(CorruptedImageError);
  });
});

function findChunk(bytes: Uint8Array, type: string): Uint8Array | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const t = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (t === type) return bytes.subarray(dataStart, dataStart + length);
    if (t === "IEND") return null;
    offset = dataStart + length + 4;
  }
  return null;
}

function countChunks(bytes: Uint8Array, type: string): number {
  let offset = 8;
  let count = 0;
  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const t = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (t === type) count++;
    if (t === "IEND") break;
    offset = offset + 8 + length + 4;
  }
  return count;
}
