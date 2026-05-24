---
title: Server-side image pipeline (compression + transcoding)
category: concept
created: 2026-05-24
updated: 2026-05-24
related: [[blog-featured-image-upload]], [[2026-05-24-validation-without-normalization]]
---

Deterministic, bounded image compression + format normalization that turns both "your image is too big" and "unsupported image type" rejections into "we handled it for you." Lives in [lib/image-pipeline.ts](../../lib/image-pipeline.ts).

## Why it exists

The blog featured-image route originally hard-rejected anything over 500 KB AND anything outside `{png, jpeg, webp}`. A 2,120 KB PNG (drag-and-dropped real-world input) was blocked on size. Then once size was fixed, a Midjourney download — saved with a `.png` extension but in some browsers reported by `File.type` as something else entirely — was blocked on MIME. Two block walls where conventional wisdom (WordPress, Ghost, Medium, Substack) says to normalize.

This module replaces both walls with normalization:
- **Size:** Sharp's quality + resize ladders bring oversize input under the 500 KB DB cap.
- **Format:** Sharp's magic-byte detection ignores the browser's `File.type` entirely (it lies on Linux and modern AI image generators). PNG/JPEG/WebP inputs persist as-is. AVIF/HEIC/GIF/TIFF inputs are transcoded to WebP, so the DB CHECK `mime IN (png, jpeg, webp)` stays satisfied without a migration.

## Algorithm

```
INPUT: buffer (≤10 MB after pre-compression server ceiling)
       (no mime param — Sharp detects it from the bytes)
GOAL:  output buffer ≤ capBytes, persisted as png|jpeg|webp

# All sharp() ingestion uses { limitInputPixels: 50_000_000 }
# Caps decompressed pixel count at 50 MP to prevent libvips memory
# bombs on Render's 512 MB hobby tier. 50 MP fits any realistic blog
# image (8000×6000 = 48 MP).

format = sharp(buffer, …).metadata().format    # 'png'|'jpeg'|'webp'|'avif'|'heif'|'gif'|'tiff'
outputMime = resolveOutputMime(format)         # transcodes non-persistable → image/webp

if format ∈ {png, jpeg, webp} AND size(buffer) ≤ capBytes:
    return buffer unchanged (skip path — no re-encode, no quality loss)

for quality in [85, 80, 75, 70, 65, 60]:
    out = encodeWithQuality(sharp(buffer, …), outputMime, quality)
    if size(out) ≤ capBytes: return out

for maxWidth in [2000, 1600, 1200]:
    out = encodeWithQuality(
        sharp(buffer, …).resize({ width: maxWidth, withoutEnlargement: true }),
        outputMime, 70)
    if size(out) ≤ capBytes: return out

throw CompressionFloorError    # caller returns 400 "resize the original"
```

The function is **deterministic** (no random tiebreakers) and **bounded** (max 6 quality attempts + 3 resize attempts = 9 encoder runs in the worst case). Typical inputs terminate in the first 1–2 quality steps.

The pipeline returns `outputMime` and `inputFormat` so the caller can persist the right MIME (DB column, R2 ContentType, filename extension) and log when the browser's reported MIME disagreed with reality.

## Input format → output format mapping

| Sharp detects | Output mime | Notes |
|---|---|---|
| `png` | `image/png` | Persists as-is. `.png({ quality, palette: true, compressionLevel: 9 })` — **`palette: true` is load-bearing.** Without it, `quality` is silently ignored. Palette PNG is lossy + indexed; alpha preserved via per-palette-index alpha. |
| `jpeg` | `image/jpeg` | Persists as-is. `.jpeg({ quality, mozjpeg: true })` — mozjpeg gets ~10–15% better compression than libjpeg-turbo at equal quality. |
| `webp` | `image/webp` | Persists as-is. `.webp({ quality })` — WebP's lossy encoder is its primary mode. |
| `avif` | `image/webp` (transcoded) | Modern AI image generators serve AVIF via content negotiation. libvips reports AVIF under the HEIF container family — but Sharp decodes it natively. |
| `heif` | `image/webp` (transcoded) | Apple ecosystem (iPhone screenshots, AirDrop). HEIC files identify as `heif`. |
| `gif` | `image/webp` (transcoded) | First frame only — featured images are static. |
| `tiff` | `image/webp` (transcoded) | Uncommon but Sharp decodes it. |
| anything else | throws `UnsupportedFormatError` | Caller returns 400 with format list. |

The transcode-to-WebP fallback keeps the DB CHECK constraint at `mime IN (png, jpeg, webp)` satisfied without a migration. WebP is a sensible default for non-persistable inputs because it has the best compression-to-quality ratio of the three persistable formats.

## Decompression-bomb protection

Every `sharp()` ingest passes `{ limitInputPixels: 50_000_000 }`. This caps the decoded pixel count at 50 MP, regardless of input file size. A 10 MB PNG that decompresses to 200 MP is rejected by libvips with a clear error rather than OOM-ing the route.

Why 50 MP:
- A typical DSLR raw export → JPEG conversion lands at ~24 MP.
- An 8000×6000 panorama is 48 MP.
- 50 MP gives headroom without leaving room for crafted bombs.
- On a Render 512 MB hobby instance, 50 MP × 3 channels × 1 byte = 150 MB peak memory for libvips processing — safe.

## Why the 500 KB DB CHECK stays in place

The constraint at `og_image_size_kb <= 500` is now *guaranteed* by the compression pipeline rather than enforced via upload rejection. Keeping the CHECK serves three purposes:

1. **Belt-and-braces.** If the pipeline ever has a bug and writes an over-cap file, the DB refuses the insert and the R2 object is orphaned (logged as "Saved to R2 but DB update failed") — louder failure than silently storing oversize images.
2. **Read-side budget.** Page-load performance budgets assume featured images are ≤ 500 KB. The DB CHECK protects that invariant.
3. **Migration cleanness.** Existing 253 migrated rows already satisfy the constraint. No need to widen it.

## Why the browser's `File.type` is ignored

The browser-reported MIME is unreliable for three observed reasons:
1. **Linux GNOME quirk** — some browsers send empty `File.type` or a generic `application/octet-stream` for PNG files when the xdg MIME cache disagrees with the filename extension.
2. **AI image generators** — Midjourney's web app serves AVIF via content negotiation. A user who right-clicks → "Save Image As" gets a `.png` filename but AVIF bytes; the browser then reports `image/avif` on upload while the OS file manager shows "PNG image."
3. **Legacy MIMEs** — `image/x-png` (IE-era) still surfaces from some upload pickers.

Sharp's magic-byte detection (`metadata().format`) is the source of truth. It reads the first ~16 bytes, identifies the format reliably, and the route logs both the browser-reported MIME and the Sharp-detected format whenever they disagree (handy for diagnosing future input variations).

## Tests

[lib/image-pipeline.test.ts](../../lib/image-pipeline.test.ts) — 8 tests covering pass-through (already-persistable + under-cap), JPEG quality ladder, PNG palette mode, WebP quality, AVIF input → WebP transcode, CompressionFloorError, UnsupportedFormatError on non-image bytes. Test fixtures use Sharp's Gaussian-noise creator so compression behaviours match real photos rather than random-noise edge cases.

## Future extensions (deferred)

See `wiki/backlog/` for the full list. The pipeline is structured to extend cleanly to:
- Preserve original at `{slug}-featured-01-orig.{ext}` for future re-encoding
- Generate blurhash placeholder for LCP
- Emit responsive sizes (480w / 1200w / 2400w) for srcset

(AVIF / HEIC / GIF / TIFF input support shipped as part of the initial implementation — see the input format mapping above.)
