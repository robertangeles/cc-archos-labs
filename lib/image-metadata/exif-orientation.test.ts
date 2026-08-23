import { describe, expect, it } from "vitest";
import {
  buildMinimalExifSegment,
  buildMinimalTiffOrientation,
  extractOrientation,
  extractOrientationFromRawTiff,
} from "./exif-orientation";

describe("buildMinimalExifSegment + extractOrientation round-trip", () => {
  it("round-trips every valid orientation value 1-8", () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const segment = buildMinimalExifSegment(orientation);
      // segment[0..1] = marker, [2..3] = length; extractOrientation expects
      // the APP1 payload starting at "Exif\0\0".
      const payload = segment.subarray(4);
      expect(extractOrientation(payload)).toBe(orientation);
    }
  });

  it("produces a well-formed marker segment (marker id, length, Exif prefix)", () => {
    const segment = buildMinimalExifSegment(6);
    expect(segment[0]).toBe(0xff);
    expect(segment[1]).toBe(0xe1);
    const length = (segment[2] << 8) | segment[3];
    expect(length).toBe(segment.length - 2);
    expect(Array.from(segment.subarray(4, 10))).toEqual([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    ]);
  });
});

describe("extractOrientation on hand-built TIFF payloads", () => {
  it("reads a big-endian IFD0 with an unrelated tag before orientation", () => {
    // "Exif\0\0" + "MM" + magic(42) + ifd0Offset(8) +
    // IFD0: count=2, [ImageWidth=800 LONG], [Orientation=6 SHORT], nextIFD=0
    const bytes = new Uint8Array([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // Exif\0\0
      0x4d, 0x4d, // MM
      0x00, 0x2a, // magic 42
      0x00, 0x00, 0x00, 0x08, // IFD0 offset = 8
      0x00, 0x02, // entry count = 2
      0x01, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x03, 0x20, // ImageWidth=800
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation=6
      0x00, 0x00, 0x00, 0x00, // next IFD = 0
    ]);
    expect(extractOrientation(bytes)).toBe(6);
  });

  it("returns null when no Orientation tag is present", () => {
    const bytes = new Uint8Array([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49,
      0x2a, 0x00,
      0x08, 0x00, 0x00, 0x00,
      0x01, 0x00, // entry count = 1
      0x00, 0x01, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00, 0x20, 0x03, 0x00, 0x00, // ImageWidth only
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(extractOrientation(bytes)).toBeNull();
  });

  it("returns null on garbage/malformed input rather than throwing", () => {
    expect(extractOrientation(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(extractOrientation(new Uint8Array(0))).toBeNull();
    const wrongPrefix = new Uint8Array(20);
    wrongPrefix.set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(extractOrientation(wrongPrefix)).toBeNull();
  });
});

describe("PNG path: buildMinimalTiffOrientation + extractOrientationFromRawTiff", () => {
  it("round-trips every valid orientation value with no Exif prefix", () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const tiff = buildMinimalTiffOrientation(orientation);
      expect(extractOrientationFromRawTiff(tiff)).toBe(orientation);
    }
  });

  it("returns null on garbage raw TIFF input", () => {
    expect(extractOrientationFromRawTiff(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
