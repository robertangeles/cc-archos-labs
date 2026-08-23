import { describe, expect, it } from "vitest";
import { buildMinimalExifSegment, extractOrientation } from "./exif-orientation";
import { CorruptedImageError, UnsupportedFileTypeError } from "./types";
import { stripJpeg } from "./jpeg";

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0_JFIF = segment(0xe0, [
  0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
  0x01, 0x01, // version
  0x00, // units
  0x00, 0x01, 0x00, 0x01, // density
  0x00, 0x00, // thumbnail dims
]);
const SOS_AND_SCAN = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, /* fake entropy */ 0xab, 0xcd, 0xef];

function xmpSegment(): number[] {
  const ns = "http://ns.adobe.com/xap/1.0/";
  const bytes = [...ns].map((c) => c.charCodeAt(0));
  return segment(0xe1, [...bytes, 0x00, 0x3c, 0x3f, 0x78, 0x3f, 0x3e]); // + null + "<?x?>"-ish filler
}

function c2paSegment(fill: number): number[] {
  return segment(0xeb, [0x4a, 0x50, 0x00, 0x01, fill, fill, fill]); // arbitrary JUMBF-ish payload
}

function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

describe("stripJpeg", () => {
  it("rejects non-JPEG magic bytes", () => {
    expect(() => stripJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(
      UnsupportedFileTypeError,
    );
  });

  it("strips EXIF and preserves orientation via a minimal synthetic segment", () => {
    // A realistic EXIF payload: big-endian IFD0 with an unrelated tag
    // (ImageWidth) ahead of Orientation=6 — bigger than the minimal
    // orientation-only segment the parser should replace it with.
    const realisticExif = segment(0xe1, [
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // Exif\0\0
      0x4d, 0x4d, // MM
      0x00, 0x2a, // magic 42
      0x00, 0x00, 0x00, 0x08, // IFD0 offset = 8
      0x00, 0x02, // entry count = 2
      0x01, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x03, 0x20, // ImageWidth=800
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation=6
      0x00, 0x00, 0x00, 0x00, // next IFD = 0
    ]);
    const bytes = jpeg(SOI, APP0_JFIF, realisticExif, SOS_AND_SCAN, EOI);
    const result = stripJpeg(bytes);

    expect(result.format).toBe("jpeg");
    expect(result.partial).toBe(false);
    expect(result.findings).toEqual([
      { id: "exif", label: "EXIF data", detail: "1 segment removed (orientation preserved)" },
    ]);

    // The original (larger) EXIF payload should be gone, replaced by the
    // minimal orientation-only segment with the same orientation value.
    const exifApp1 = findApp1(result.cleaned, isExif);
    expect(exifApp1).not.toBeNull();
    expect(extractOrientation(exifApp1!)).toBe(6);
    const minimal = buildMinimalExifSegment(6);
    expect(Array.from(exifApp1!)).toEqual(Array.from(minimal.subarray(4)));
    expect(exifApp1!.length).toBeLessThan(realisticExif.length - 4);
  });

  it("strips XMP distinctly from EXIF", () => {
    const bytes = jpeg(SOI, xmpSegment(), SOS_AND_SCAN, EOI);
    const result = stripJpeg(bytes);
    expect(result.findings).toEqual([
      { id: "xmp", label: "XMP metadata", detail: "1 segment removed" },
    ]);
    expect(findApp1(result.cleaned, isXmp)).toBeNull();
  });

  it("removes every APP11 segment in a multi-segment C2PA/JUMBF manifest", () => {
    const bytes = jpeg(SOI, c2paSegment(0x01), c2paSegment(0x02), SOS_AND_SCAN, EOI);
    const result = stripJpeg(bytes);
    expect(result.findings).toEqual([
      {
        id: "c2pa",
        label: "C2PA content-credentials manifest",
        detail: "2 segments removed",
      },
    ]);
    // No APP11 (0xEB) marker survives anywhere before SOS.
    expect(countMarker(result.cleaned, 0xeb)).toBe(0);
  });

  it("reports zero findings and passes through a clean JPEG unchanged apart from SOI/EOI framing", () => {
    const bytes = jpeg(SOI, APP0_JFIF, SOS_AND_SCAN, EOI);
    const result = stripJpeg(bytes);
    expect(result.findings).toEqual([]);
    expect(result.partial).toBe(false);
    expect(Array.from(result.cleaned)).toEqual(Array.from(bytes));
  });

  it("tolerates a missing trailing EOI (some encoders omit it)", () => {
    const bytes = jpeg(SOI, APP0_JFIF, SOS_AND_SCAN); // no EOI
    const result = stripJpeg(bytes);
    expect(result.findings).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it("throws a typed error when a segment length field overruns the buffer", () => {
    const bytes = jpeg(SOI, [0xff, 0xe1, 0xff, 0xff]); // claims a huge length, file ends immediately
    expect(() => stripJpeg(bytes)).toThrow(CorruptedImageError);
  });

  it("throws a typed error on a truncated file (cut mid-marker)", () => {
    const bytes = jpeg(SOI, [0xff]); // dangling marker byte, nothing after
    expect(() => stripJpeg(bytes)).toThrow(CorruptedImageError);
  });

  it("throws a typed error on an invalid (too-short) segment length", () => {
    const bytes = jpeg(SOI, [0xff, 0xe1, 0x00, 0x01]); // length=1, invalid (min is 2)
    expect(() => stripJpeg(bytes)).toThrow(CorruptedImageError);
  });
});

function isExif(payload: Uint8Array): boolean {
  const prefix = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  return prefix.every((b, i) => payload[i] === b);
}
function isXmp(payload: Uint8Array): boolean {
  const ns = "http://ns.adobe.com/xap/1.0/";
  return [...ns].every((c, i) => payload[i] === c.charCodeAt(0));
}

// Minimal marker-segment walk for test assertions only (does not need to be
// robust — just needs to find the first matching APP1 payload, or a count).
function findApp1(bytes: Uint8Array, match: (payload: Uint8Array) => boolean): Uint8Array | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const payload = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && match(payload)) return payload;
    offset += 2 + length;
  }
  return null;
}

function countMarker(bytes: Uint8Array, marker: number): number {
  let offset = 2;
  let count = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const m = bytes[offset + 1];
    if (m === 0xda) break;
    if (m === marker) count++;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 2 + length;
  }
  return count;
}
