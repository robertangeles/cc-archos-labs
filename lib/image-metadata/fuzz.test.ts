// Seeded mutation loop over the happy-path fixtures — the CEO review's "ship
// at 2am Friday" bar for a hand-rolled binary parser reading attacker-shaped
// length fields directly off file bytes. Asserts, on every mutated input:
// (1) bounded wall-clock time (no hang); (2) only ever throws the module's
// own typed errors, never an unrelated crash; (3) never allocates something
// visibly larger than the input itself.
//
// Seeded (not Math.random with no seed) so a failure is reproducible: rerun
// with the printed seed to get the exact same mutation sequence.

import { describe, expect, it } from "vitest";
import { stripImage } from "./index";
import { CorruptedImageError, UnsupportedFileTypeError } from "./types";
import { crc32 } from "./bytes";
import { buildMinimalTiffOrientation } from "./exif-orientation";

// Minimal, deterministic PRNG (mulberry32) — no dependency, reproducible
// from an integer seed.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const crcBytes = [(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff];
  return [...lengthBytes, ...typeBytes, ...data, ...crcBytes];
}

function buildSeedJpeg(): Uint8Array {
  const exifSeg = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...buildMinimalTiffOrientation(6)];
  const c2paSeg = [0xff, 0xeb, 0x00, 0x06, 0x4a, 0x50];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xab, 0xcd, 0xef];
  return new Uint8Array([0xff, 0xd8, ...exifSeg, ...c2paSeg, ...sos, 0xff, 0xd9]);
}

function buildSeedPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const exif = chunk("eXIf", Array.from(buildMinimalTiffOrientation(6)));
  const cabx = chunk("caBX", [0x4a, 0x50, 0x01, 0x02]);
  const iend = chunk("IEND", []);
  return new Uint8Array([...sig, ...ihdr, ...exif, ...cabx, ...iend]);
}

function fuzzOne(seedBytes: Uint8Array, rand: () => number): void {
  const mutated = new Uint8Array(seedBytes);
  const mutationCount = 1 + Math.floor(rand() * 5);
  for (let i = 0; i < mutationCount; i++) {
    const idx = Math.floor(rand() * mutated.length);
    mutated[idx] = Math.floor(rand() * 256);
  }
  // Occasionally truncate instead of/as well as byte-flipping.
  const input = rand() < 0.3 ? mutated.subarray(0, Math.floor(rand() * mutated.length)) : mutated;

  const start = performance.now();
  try {
    const result = stripImage(input);
    // (3) never hand back more bytes than the input could plausibly produce
    // (stripping only ever removes segments/chunks or replaces them with a
    // strictly smaller synthetic one — output can never exceed input size).
    expect(result.cleaned.length).toBeLessThanOrEqual(input.length + 64);
  } catch (err) {
    expect(err instanceof CorruptedImageError || err instanceof UnsupportedFileTypeError).toBe(
      true,
    );
  }
  const elapsed = performance.now() - start;
  // (1) bounded wall-clock time — generous budget, this should be sub-ms in
  // practice; a real hang would blow past this by orders of magnitude.
  expect(elapsed).toBeLessThan(200);
}

describe("stripImage fuzz (seeded, reproducible)", () => {
  const SEED = 20260823;

  it("survives 500 random mutations of a seed JPEG without an unrelated throw or a hang", () => {
    const rand = mulberry32(SEED);
    const seed = buildSeedJpeg();
    for (let i = 0; i < 500; i++) fuzzOne(seed, rand);
  });

  it("survives 500 random mutations of a seed PNG without an unrelated throw or a hang", () => {
    const rand = mulberry32(SEED + 1);
    const seed = buildSeedPng();
    for (let i = 0; i < 500; i++) fuzzOne(seed, rand);
  });
});
