import "server-only";
import sharp from "sharp";
import { generateImage } from "../image-gen/service";
import { buildImagePrompt, parseImagePrompt } from "./parse-image-prompt";

// Turns the illustration step's output into bytes the post can carry.
//
// Never throws. An image is the one part of a post that can fail without
// making the post wrong, so every failure here degrades to `null` and the
// caller attaches the house fallback instead. A cron that dies because an
// image model was rate-limited would be a worse outcome than a post with a
// generic illustration.

/**
 * The template renders featured images at `aspect-[29/10]`, and 2.9:1 is not a
 * ratio the model offers — its widest is 21:9 (2.333:1). So generate at 21:9
 * and crop, rather than accepting letterboxing or a stretched image.
 *
 * The crop happens server-side because the raw file is what social cards, RSS
 * enclosures and JSON-LD all serve; a CSS-only crop would leave every shared
 * link showing the uncropped version.
 */
const TARGET_RATIO = 2.9;
const SOURCE_ASPECT = "21:9" as const;
/**
 * 2K measured over three real runs: headers at 10.1-10.6s, full body at
 * 14.8-16.4s. `generateImage` bounds time-to-headers at 25s (its AbortController
 * is cleared in a `finally` once `await fetch` resolves), so the margin is
 * roughly 2.5x. Raising this to 4K would eat that margin and start timing out.
 */
const SOURCE_SIZE = "2K" as const;

/** Remote-URL results are rare (the model usually inlines a data: URI). */
const DOWNLOAD_TIMEOUT_MS = 20_000;

export interface GeneratedPostImage {
  buffer: Buffer;
  /** May be empty — the caller supplies a fallback description. */
  alt: string;
}

/**
 * Generate and crop the featured illustration for one post.
 *
 * Returns `null` on any failure: an unparseable prompt, a model error, a
 * timeout, a response with no image, or bytes Sharp cannot read.
 */
export async function generatePostImage(
  imagePrompt: string,
): Promise<GeneratedPostImage | null> {
  const parsed = parseImagePrompt(imagePrompt);
  if (!parsed) {
    console.warn("[blog-agent] image prompt unusable after normalising");
    return null;
  }

  let imageUrl: string;
  try {
    const result = await generateImage(buildImagePrompt(parsed.scene), {
      aspectRatio: SOURCE_ASPECT,
      imageSize: SOURCE_SIZE,
    });
    imageUrl = result.imageUrl;
  } catch (err) {
    console.warn("[blog-agent] image generation failed:", err);
    return null;
  }

  let raw: Buffer;
  try {
    raw = await toBuffer(imageUrl);
  } catch (err) {
    console.warn("[blog-agent] could not read generated image:", err);
    return null;
  }

  try {
    const trimmed = await trimWhiteBorder(raw);
    return { buffer: await cropToRatio(trimmed, TARGET_RATIO), alt: parsed.altText };
  } catch (err) {
    console.warn("[blog-agent] crop failed:", err);
    return null;
  }
}

/**
 * Remove a white matte if the model added one.
 *
 * Gemini intermittently renders the illustration inside a white border, like a
 * framed print, and it does this even when the prompt explicitly asks for full
 * bleed with no border, no margin, no mat and no frame — observed on the house
 * fallback image, whose prompt contained exactly that clause. So it is handled
 * here rather than asked for.
 *
 * Only white is trimmed: the top-left pixel of a correct image is deep navy,
 * which will not match, so a borderless image passes through untouched. The
 * 80% guard catches the pathological case of a mostly-white image, where
 * trimming would destroy the picture rather than tidy it.
 */
async function trimWhiteBorder(input: Buffer): Promise<Buffer> {
  const before = await sharp(input).metadata();
  if (!before.width || !before.height) return input;

  let out: Buffer;
  try {
    out = await sharp(input)
      .trim({ background: "#ffffff", threshold: 15 })
      .toBuffer();
  } catch {
    // Sharp throws when a trim would leave nothing at all.
    return input;
  }

  const after = await sharp(out).metadata();
  if (!after.width || !after.height) return input;
  if (after.width < before.width * 0.8 || after.height < before.height * 0.8) {
    return input;
  }
  return out;
}

/** Decode a `data:` URI, or download an http(s) one. */
async function toBuffer(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma < 0) throw new Error("malformed data URI");
    return Buffer.from(imageUrl.slice(comma + 1), "base64");
  }
  const res = await fetch(imageUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`image download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Centre-crop to `ratio`, taking the largest rectangle of that shape that fits.
 *
 * Crops whichever axis has slack rather than assuming the source is wider than
 * the target. The model honours the requested aspect ratio approximately, not
 * exactly, and a fixed "crop the height" would extract past the bottom edge on
 * a source that came back narrower than 2.9 — which Sharp rejects outright.
 */
export async function cropToRatio(input: Buffer, ratio: number): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error("no dimensions on generated image");

  let cropWidth = width;
  let cropHeight = Math.round(width / ratio);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(height * ratio);
  }

  return sharp(input)
    .extract({
      left: Math.floor((width - cropWidth) / 2),
      top: Math.floor((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .toBuffer();
}
