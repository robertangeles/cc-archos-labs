import "server-only";
import sharp, { type Sharp } from "sharp";

// Server-side image compression for featured-image uploads.
//
// Used by app/api/admin/posts/[id]/image/route.ts. When an admin
// uploads an image that exceeds the 500 KB DB CHECK constraint,
// this module runs a deterministic quality + resize ladder to bring
// it under cap before the R2 put + DB persist.
//
// Pipeline:
//
//   INPUT (≤10 MB on disk)
//        │
//        ▼
//   sharp(buffer, { limitInputPixels: 50 MP })   ← decompression-bomb guard
//        │
//        ▼
//   size ≤ cap? ── yes ──▶ return unchanged (skip path, no re-encode)
//        │ no
//        ▼
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

export class CompressionFloorError extends Error {
  constructor(message = "Image cannot be compressed below the size limit.") {
    super(message);
    this.name = "CompressionFloorError";
  }
}

export interface CompressResult {
  buffer: Buffer;
  sizeBytes: number;
  sizeKb: number;
  compressed: boolean;
  qualityUsed?: number;
  resizedTo?: number;
}

// Selects the Sharp encoder for the input mime and runs it with the
// given quality. Used by both the quality loop and the resize loop —
// keeps encoder selection DRY.
async function encodeWithQuality(
  pipeline: Sharp,
  mime: string,
  quality: number,
): Promise<Buffer> {
  switch (mime) {
    case "image/png":
      return pipeline
        .png({ quality, palette: true, compressionLevel: 9 })
        .toBuffer();
    case "image/jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    case "image/webp":
      return pipeline.webp({ quality }).toBuffer();
    default:
      throw new Error(`Unsupported mime for compression: ${mime}`);
  }
}

// Decode-bomb-safe Sharp factory. Always use this rather than calling
// sharp() directly so the pixel cap is applied uniformly.
function load(buffer: Buffer): Sharp {
  return sharp(buffer, { limitInputPixels: PIXEL_CAP });
}

// Compress `buffer` until it fits inside `capBytes`, or throw.
//
// Returns the original buffer unchanged when it is already under cap
// (no re-encode = no quality loss = no risk).
//
// Throws CompressionFloorError if neither the quality ladder nor the
// resize ladder can satisfy the cap. The caller is expected to
// translate that into a 400 with a clear user message.
//
// May also throw if Sharp cannot decode the input (corrupt bytes,
// truncated file, libvips pixel-cap violation). The caller should
// catch generic errors and return a 400 "could not process image".
export async function compressImageIfOverCap(
  buffer: Buffer,
  mime: string,
  capBytes: number,
): Promise<CompressResult> {
  if (buffer.byteLength <= capBytes) {
    return {
      buffer,
      sizeBytes: buffer.byteLength,
      sizeKb: Math.round(buffer.byteLength / 1024),
      compressed: false,
    };
  }

  for (const quality of QUALITY_LADDER) {
    const out = await encodeWithQuality(load(buffer), mime, quality);
    if (out.byteLength <= capBytes) {
      return {
        buffer: out,
        sizeBytes: out.byteLength,
        sizeKb: Math.round(out.byteLength / 1024),
        compressed: true,
        qualityUsed: quality,
      };
    }
  }

  for (const maxWidth of RESIZE_LADDER) {
    const out = await encodeWithQuality(
      load(buffer).resize({ width: maxWidth, withoutEnlargement: true }),
      mime,
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
      };
    }
  }

  throw new CompressionFloorError();
}
