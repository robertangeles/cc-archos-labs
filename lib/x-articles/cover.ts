import sharp from "sharp";

// Article cover for X: exactly 5:2 (1500 x 600 at most). Our post covers are about
// 2.9:1, so the crop is ours and centered rather than left to X's editor. The crop
// is taken at source resolution and only scaled down, never up. Output is always
// JPEG; a PNG's transparency goes onto white.
//
// shortcut: EXIF orientation is ignored (our covers are generated, not photographed),
// upgrade if a rotated cover ever appears.

const MAX_WIDTH = 1500;
const MAX_HEIGHT = 600;
const QUALITY = 85;
const PIXEL_CAP = 50_000_000;

export type CoverResult = { ok: true; value: Uint8Array } | { ok: false; detail: string };

export async function cropCoverTo52(bytes: Uint8Array): Promise<CoverResult> {
  try {
    const image = sharp(bytes, { limitInputPixels: PIXEL_CAP });
    const { width, height } = await image.metadata();
    if (!width || !height) return { ok: false, detail: "unreadable image" };

    // The largest 5k x 2k box that fits, so the ratio is exact in whole pixels.
    const k = Math.min(Math.floor(width / 5), Math.floor(height / 2));
    if (k < 1) return { ok: false, detail: "image too small" };
    const crop = {
      left: Math.floor((width - 5 * k) / 2),
      top: Math.floor((height - 2 * k) / 2),
      width: 5 * k,
      height: 2 * k,
    };

    let pipeline = image.flatten({ background: "#ffffff" }).extract(crop);
    if (crop.width > MAX_WIDTH) pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT);
    return { ok: true, value: await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer() };
  } catch {
    // sharp's message can name the input; the caller only needs to know it failed.
    return { ok: false, detail: "unreadable image" };
  }
}
