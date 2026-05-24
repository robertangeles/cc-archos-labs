---
title: Server-side image pipeline (compression)
category: concept
created: 2026-05-24
updated: 2026-05-24
related: [[blog-featured-image-upload]], [[2026-05-24-validation-without-normalization]]
---

Deterministic, bounded image compression that turns "your image is too big" rejections into "we handled it for you." Lives in [lib/image-pipeline.ts](../../lib/image-pipeline.ts).

## Why it exists

The blog featured-image route originally hard-rejected anything over 500 KB. A 2,120 KB PNG (drag-and-dropped real-world input) was blocked outright, leaving the admin to leave the UI, find a third-party compression tool, and re-upload. Every modern CMS (WordPress, Ghost, Medium, Substack) accepts what you upload and optimizes server-side. This module brings the project in line with that conventional wisdom.

## Algorithm

```
INPUT: buffer (≤10 MB after pre-compression server ceiling), mime
GOAL:  output buffer ≤ capBytes

# All sharp() ingestion uses { limitInputPixels: 50_000_000 }
# Caps decompressed pixel count at 50 MP to prevent libvips memory
# bombs on Render's 512 MB hobby tier. 50 MP fits any realistic blog
# image (8000×6000 = 48 MP).

if size(buffer) ≤ capBytes:
    return buffer unchanged (skip path — no re-encode, no quality loss)

for quality in [85, 80, 75, 70, 65, 60]:
    out = encodeWithQuality(sharp(buffer, …), mime, quality)
    if size(out) ≤ capBytes: return out

for maxWidth in [2000, 1600, 1200]:
    out = encodeWithQuality(
        sharp(buffer, …).resize({ width: maxWidth, withoutEnlargement: true }),
        mime, 70)
    if size(out) ≤ capBytes: return out

throw CompressionFloorError    # caller returns 400 "resize the original"
```

The function is **deterministic** (no random tiebreakers) and **bounded** (max 6 quality attempts + 3 resize attempts = 9 encoder runs in the worst case). Typical inputs terminate in the first 1–2 quality steps.

## Encoder selection per mime

| Mime | Sharp call | Notes |
|---|---|---|
| `image/png` | `.png({ quality, palette: true, compressionLevel: 9 })` | **`palette: true` is load-bearing.** Without it, `quality` is silently ignored and the quality ladder produces identical bytes. Palette PNG is lossy + indexed; alpha is preserved via per-palette-index alpha. |
| `image/jpeg` | `.jpeg({ quality, mozjpeg: true })` | mozjpeg encoder gets ~10–15% better compression than libjpeg-turbo at equal quality. |
| `image/webp` | `.webp({ quality })` | WebP's lossy encoder is its primary mode; no extra flags needed. |
| anything else | throws | The route validates mime before reaching this module. |

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

## Tests

[lib/image-pipeline.test.ts](../../lib/image-pipeline.test.ts) — 7 tests covering pass-through, JPEG quality ladder, PNG palette mode, WebP quality, CompressionFloorError, unsupported mime, corrupt buffer. Test fixtures use Sharp's Gaussian-noise creator so compression behaviours match real photos rather than random-noise edge cases.

## Future extensions (deferred)

See `wiki/backlog/` for the full list. The pipeline is structured to extend cleanly to:
- Preserve original at `{slug}-featured-01-orig.{ext}` for future re-encoding
- Generate blurhash placeholder for LCP
- Emit responsive sizes (480w / 1200w / 2400w) for srcset
- Accept HEIC / AVIF inputs (widen mime CHECK)
