import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropCoverTo52 } from "./cover";

// Real encodes only (no mocks): every case builds an image with sharp, crops it and
// reads the result back. Marker columns or rows at the edges prove the crop is centered.

const RED = "#ff0000";
const GREEN = "#00aa00";
const BLUE = "#0000ff";

type Fmt = "jpeg" | "png";

// A green image with a red band on the first `edge` columns and a blue band on the last.
async function sideMarked(width: number, height: number, edge: number, fmt: Fmt = "jpeg") {
  const band = (background: string, w: number) => ({ create: { width: w, height, channels: 3 as const, background } });
  return sharp({ create: { width, height, channels: 3, background: GREEN } })
    .composite([
      { input: band(RED, edge), left: 0, top: 0 },
      { input: band(BLUE, edge), left: width - edge, top: 0 },
    ])
    [fmt]()
    .toBuffer();
}

// A green image with a red band on the first `edge` rows and a blue band on the last.
async function topBottomMarked(width: number, height: number, edge: number) {
  const band = (background: string) => ({ create: { width, height: edge, channels: 3 as const, background } });
  return sharp({ create: { width, height, channels: 3, background: GREEN } })
    .composite([
      { input: band(RED), left: 0, top: 0 },
      { input: band(BLUE), left: 0, top: height - edge },
    ])
    .png()
    .toBuffer();
}

async function crop(bytes: Uint8Array) {
  const r = await cropCoverTo52(bytes);
  if (!r.ok) throw new Error(`expected ok, got: ${r.detail}`);
  return r.value;
}

async function pixels(bytes: Uint8Array) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels).subarray(0, 3)];
  return { at, width: info.width, height: info.height };
}

// Dominant channel of a JPEG pixel survives compression; exact values do not.
const isGreen = ([r, g, b]: number[]) => g > 100 && r < 80 && b < 80;

describe("cropCoverTo52", () => {
  it("crops a 3168x1092 JPEG to a centered 1500x600 JPEG", async () => {
    const out = await crop(await sideMarked(3168, 1092, 150));
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1500, height: 600 });
    // The 150px red and blue bands sit inside the 219px cut off each side.
    const p = await pixels(out);
    expect(isGreen(p.at(0, 300))).toBe(true);
    expect(isGreen(p.at(1499, 300))).toBe(true);
  });

  it("does not upscale: a 1200x414 PNG becomes 1035x414", async () => {
    const out = await crop(await sideMarked(1200, 414, 40, "png"));
    expect(await sharp(out).metadata()).toMatchObject({ format: "jpeg", width: 1035, height: 414 });
  });

  it.each([
    [3168, 1092],
    [3060, 1055],
    [1856, 640],
    [1600, 552],
    [1200, 414],
    [1001, 333],
    [2000, 2000],
    [900, 100],
  ])("outputs exactly 5:2 from %ix%i", async (w, h) => {
    const { width, height } = await sharp(await crop(await sideMarked(w, h, 10))).metadata();
    expect(width! * 2).toBe(height! * 5);
    expect(width).toBeLessThanOrEqual(1500);
  });

  it("keeps an image that is already 5:2 at its size, and caps a bigger one at 1500x600", async () => {
    const small = await sharp(await crop(await sideMarked(800, 320, 10))).metadata();
    expect([small.width, small.height]).toEqual([800, 320]);
    const big = await sharp(await crop(await sideMarked(3000, 1200, 10))).metadata();
    expect([big.width, big.height]).toEqual([1500, 600]);
  });

  it("crops a tall portrait from the vertical center", async () => {
    const out = await crop(await topBottomMarked(800, 1200, 300));
    expect(await sharp(out).metadata()).toMatchObject({ width: 800, height: 320 });
    const p = await pixels(out);
    expect(isGreen(p.at(400, 0))).toBe(true);
    expect(isGreen(p.at(400, 319))).toBe(true);
  });

  it("flattens transparency onto white instead of black", async () => {
    const transparent = await sharp({
      create: { width: 1000, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const p = await pixels(await crop(transparent));
    expect(p.at(500, 200).every((v) => v > 240)).toBe(true);
  });

  it.each([
    ["garbage bytes", new Uint8Array([1, 2, 3, 4, 5])],
    ["no bytes", new Uint8Array()],
    ["a text file", new TextEncoder().encode("<html>not an image</html>")],
  ])("refuses %s without throwing", async (_name, bytes) => {
    expect(await cropCoverTo52(bytes)).toEqual({ ok: false, detail: "unreadable image" });
  });

  it("refuses an image too small to hold a 5:2 crop", async () => {
    const tiny = await sharp({ create: { width: 4, height: 1, channels: 3, background: GREEN } }).png().toBuffer();
    expect(await cropCoverTo52(tiny)).toEqual({ ok: false, detail: "image too small" });
  });
});
