import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CompressionFloorError,
  compressImageIfOverCap,
} from "./image-pipeline";

// These tests synthesize image bytes at runtime via Sharp rather than
// committing fixture files.
//
// Inputs use Sharp's `create.noise` with Gaussian noise on a flat
// background. Gaussian noise has photo-grain entropy — it compresses
// like a real photo (JPEG q95 → q60 reduces ~4×), unlike uniform
// random noise which is mathematically incompressible.
//
// All inputs sit comfortably above the 500 KB DB cap, exercising the
// compression path. Probed sizes (gaussian σ=30 on #888888):
//   - 1500×1000 JPEG  q95: ~1.0 MB     q60: ~234 KB
//   - 1500×1000 WebP  q100: ~1.3 MB    q60: ~491 KB
//   - 800×600   PNG   palette q60: ~360 KB

function noisyOptions(width: number, height: number) {
  return {
    create: {
      width,
      height,
      channels: 3 as const,
      background: "#888888",
      noise: { type: "gaussian" as const, mean: 128, sigma: 30 },
    },
  };
}

async function makeNoisyJpeg(
  width: number,
  height: number,
  quality = 95,
): Promise<Buffer> {
  return sharp(noisyOptions(width, height))
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function makeNoisyPng(width: number, height: number): Promise<Buffer> {
  return sharp(noisyOptions(width, height))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function makeNoisyWebp(
  width: number,
  height: number,
  quality = 100,
): Promise<Buffer> {
  return sharp(noisyOptions(width, height)).webp({ quality }).toBuffer();
}

const CAP_500_KB = 500 * 1024;

describe("compressImageIfOverCap", () => {
  it("returns the buffer unchanged when already under cap", async () => {
    const small = await makeNoisyJpeg(200, 200, 80); // a few KB
    expect(small.byteLength).toBeLessThan(CAP_500_KB);

    const result = await compressImageIfOverCap(small, "image/jpeg", CAP_500_KB);

    expect(result.compressed).toBe(false);
    expect(result.buffer).toBe(small); // identity, not just equal
    expect(result.sizeBytes).toBe(small.byteLength);
    expect(result.qualityUsed).toBeUndefined();
    expect(result.resizedTo).toBeUndefined();
  });

  it("compresses an over-cap JPEG below the cap", async () => {
    const big = await makeNoisyJpeg(1500, 1000, 95);
    expect(big.byteLength).toBeGreaterThan(CAP_500_KB);

    const result = await compressImageIfOverCap(big, "image/jpeg", CAP_500_KB);

    expect(result.compressed).toBe(true);
    expect(result.sizeBytes).toBeLessThanOrEqual(CAP_500_KB);
    expect(
      result.qualityUsed !== undefined || result.resizedTo !== undefined,
    ).toBe(true);
  }, 30_000);

  it("compresses an over-cap PNG below the cap via palette mode", async () => {
    // Palette PNG quantization is the load-bearing detail flagged in
    // the eng review. Without `palette: true`, the quality ladder would
    // be a no-op for PNG.
    const big = await makeNoisyPng(800, 600);
    if (big.byteLength <= CAP_500_KB) return; // skip if it stayed small

    const result = await compressImageIfOverCap(big, "image/png", CAP_500_KB);

    expect(result.compressed).toBe(true);
    expect(result.sizeBytes).toBeLessThanOrEqual(CAP_500_KB);
  }, 60_000);

  it("compresses an over-cap WebP below the cap", async () => {
    // The WebP branch of the encoder switch.
    const big = await makeNoisyWebp(1500, 1000, 100);
    if (big.byteLength <= CAP_500_KB) return; // skip if it stayed small

    const result = await compressImageIfOverCap(big, "image/webp", CAP_500_KB);

    expect(result.compressed).toBe(true);
    expect(result.sizeBytes).toBeLessThanOrEqual(CAP_500_KB);
  }, 30_000);

  it("throws CompressionFloorError when the cap is unreachable", async () => {
    // Cap of 100 bytes — no real image fits, both ladders exhaust.
    const big = await makeNoisyJpeg(800, 600, 95);
    const impossibleCap = 100;

    await expect(
      compressImageIfOverCap(big, "image/jpeg", impossibleCap),
    ).rejects.toBeInstanceOf(CompressionFloorError);
  }, 30_000);

  it("rejects unsupported mime types", async () => {
    const big = await makeNoisyJpeg(1500, 1000, 95);

    await expect(
      compressImageIfOverCap(big, "image/gif", CAP_500_KB),
    ).rejects.toThrow(/Unsupported mime/);
  }, 30_000);

  it("throws on corrupt buffer so the caller can return 400", async () => {
    const garbage = Buffer.from("not actually an image", "utf-8");
    // Above cap so the compression path is taken (not pass-through).
    const padded = Buffer.concat([garbage, Buffer.alloc(CAP_500_KB + 1)]);

    await expect(
      compressImageIfOverCap(padded, "image/jpeg", CAP_500_KB),
    ).rejects.toThrow();
  });
});
