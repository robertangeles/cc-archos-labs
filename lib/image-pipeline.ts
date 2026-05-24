import "server-only";
import sharp, { type Sharp } from "sharp";

// Server-side image normalization for featured-image uploads.
//
// Used by app/api/admin/posts/[id]/image/route.ts. Sharp inspects the
// actual file bytes (the browser's File.type is unreliable — some Linux
// browsers send empty type, some send legacy `image/x-png`, and AI
// image generators increasingly serve AVIF with misleading filenames).
// The detected format becomes the source of truth.
//
// Pipeline:
//
//   INPUT (≤10 MB on disk, any image format Sharp can decode)
//        │
//        ▼
//   sharp(buffer, { limitInputPixels: 50 MP }).metadata()
//        │  detects format from magic bytes — ignores browser's type
//        ▼
//   resolveOutputMime(format)
//        │  png / jpeg / webp → persist as-is
//        │  avif / heif / gif / tiff → transcode to WebP
//        │  anything else → reject
//        ▼
//   already-persistable + under-cap?
//        │  yes → pass through unchanged (skip path)
//        │  no  ▼
//   Quality ladder: 85 → 80 → 75 → 70 → 65 → 60
//        │
//        ▼
//   Resize ladder (q=70): 2000w → 1600w → 1200w
//        │
//        ▼
//   throw CompressionFloorError (route returns 400)
//
// PNG note: Sharp's .png({ quality }) is silently ignored unless
// `palette: true` is set. Palette-mode PNG is lossy and indexed,
// supports alpha via palette indices, and is what makes the quality
// ladder actually compress PNG inputs.

const PIXEL_CAP = 50_000_000;
const QUALITY_LADDER = [85, 80, 75, 70, 65, 60] as const;
const RESIZE_LADDER = [2000, 1600, 1200] as const;
const RESIZE_QUALITY = 70;

// Sharp metadata.format values we accept. Anything else throws.
//   png / jpeg / webp → persist in the input format
//   avif / heif / gif / tiff → decode + transcode to webp
// SVG is deliberately excluded — featured images need raster dimensions.
const PERSIST_AS_IS: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const TRANSCODE_TO_WEBP = new Set(["avif", "heif", "gif", "tiff"]);

export class CompressionFloorError extends Error {
  constructor(message = "Image cannot be compressed below the size limit.") {
    super(message);
    this.name = "CompressionFloorError";
  }
}

export class UnsupportedFormatError extends Error {
  constructor(detectedFormat: string | undefined) {
    super(
      detectedFormat
        ? `Detected image format "${detectedFormat}" is not supported.`
        : "Could not detect image format from file bytes.",
    );
    this.name = "UnsupportedFormatError";
  }
}

export interface CompressResult {
  buffer: Buffer;
  sizeBytes: number;
  sizeKb: number;
  compressed: boolean;
  // The MIME we persist to R2 + DB. Always one of image/png,
  // image/jpeg, image/webp — regardless of input format.
  outputMime: "image/png" | "image/jpeg" | "image/webp";
  qualityUsed?: number;
  resizedTo?: number;
  // The Sharp-detected input format (for logging / debugging).
  inputFormat: string;
}

// Sharp encoder selection for our three persistable output formats.
async function encodeWithQuality(
  pipeline: Sharp,
  outputMime: string,
  quality: number,
): Promise<Buffer> {
  switch (outputMime) {
    case "image/png":
      // palette: true is REQUIRED for lossy PNG. Without it, `quality`
      // is silently ignored and the quality ladder produces identical
      // bytes.
      return pipeline
        .png({ quality, palette: true, compressionLevel: 9 })
        .toBuffer();
    case "image/jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    case "image/webp":
      return pipeline.webp({ quality }).toBuffer();
    default:
      throw new Error(`Unsupported output mime: ${outputMime}`);
  }
}

// Decode-bomb-safe Sharp factory. Always use this rather than calling
// sharp() directly so the pixel cap is applied uniformly.
function load(buffer: Buffer): Sharp {
  return sharp(buffer, { limitInputPixels: PIXEL_CAP });
}

// Resolve the final outputMime from Sharp's detected format. Throws
// UnsupportedFormatError for anything Sharp can't decode or that we
// don't want to persist (SVG, BMP, etc).
function resolveOutputMime(format: string | undefined): CompressResult["outputMime"] {
  if (format && format in PERSIST_AS_IS) {
    return PERSIST_AS_IS[format] as CompressResult["outputMime"];
  }
  if (format && TRANSCODE_TO_WEBP.has(format)) {
    return "image/webp";
  }
  throw new UnsupportedFormatError(format);
}

// Compress `buffer` until it fits inside `capBytes`, transcoding the
// input format if necessary so the persisted bytes are always one of
// {png, jpeg, webp}.
//
// Returns the original buffer unchanged when (a) Sharp detects it as
// already persistable AND (b) it is already under cap (no re-encode =
// no quality loss = no risk).
//
// Throws:
//   UnsupportedFormatError  — Sharp could not decode the buffer, or
//                              the detected format is not on our
//                              accept-list (SVG, BMP, etc).
//   CompressionFloorError   — Quality + resize ladders both exhausted
//                              without satisfying the cap.
//   (other Error)           — Sharp internal failure (corrupt bytes,
//                              libvips pixel-cap violation, etc).
export async function compressImageIfOverCap(
  buffer: Buffer,
  capBytes: number,
): Promise<CompressResult> {
  // Step 1: detect format from bytes (the browser's File.type is
  // ignored; Sharp's magic-byte sniffing is the source of truth).
  let format: string | undefined;
  try {
    const meta = await load(buffer).metadata();
    format = meta.format;
  } catch (err) {
    throw new UnsupportedFormatError(undefined);
  }
  const outputMime = resolveOutputMime(format);

  // Step 2: skip path — already persistable AND under cap.
  const inputIsPersistable = !!format && format in PERSIST_AS_IS;
  if (inputIsPersistable && buffer.byteLength <= capBytes) {
    return {
      buffer,
      sizeBytes: buffer.byteLength,
      sizeKb: Math.round(buffer.byteLength / 1024),
      compressed: false,
      outputMime,
      inputFormat: format!,
    };
  }

  // Step 3: quality ladder.
  for (const quality of QUALITY_LADDER) {
    const out = await encodeWithQuality(load(buffer), outputMime, quality);
    if (out.byteLength <= capBytes) {
      return {
        buffer: out,
        sizeBytes: out.byteLength,
        sizeKb: Math.round(out.byteLength / 1024),
        compressed: true,
        qualityUsed: quality,
        outputMime,
        inputFormat: format!,
      };
    }
  }

  // Step 4: resize ladder.
  for (const maxWidth of RESIZE_LADDER) {
    const out = await encodeWithQuality(
      load(buffer).resize({ width: maxWidth, withoutEnlargement: true }),
      outputMime,
      RESIZE_QUALITY,
    );
    if (out.byteLength <= capBytes) {
      return {
        buffer: out,
        sizeBytes: out.byteLength,
        sizeKb: Math.round(out.byteLength / 1024),
        compressed: true,
        qualityUsed: RESIZE_QUALITY,
        resizedTo: maxWidth,
        outputMime,
        inputFormat: format!,
      };
    }
  }

  throw new CompressionFloorError();
}
