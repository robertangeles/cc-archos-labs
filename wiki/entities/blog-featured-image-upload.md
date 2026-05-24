---
title: Blog featured-image upload
category: entity
created: 2026-05-24
updated: 2026-05-24
related: [[image-pipeline]], [[deployment-architecture]], [[2026-05-24-validation-without-normalization]]
---

The admin pipeline that gets a featured image from the user's disk onto the public blog post page. Lives at `PUT /api/admin/posts/[id]/image` and the admin form at `/admin/blog/posts/[id]`.

## Pipeline

```
admin UI (post-form.tsx)
  │  drag-drop or click → File object
  │  client validates: alt non-empty, size ≤ 10 MB
  ▼
PUT /api/admin/posts/[id]/image     (proxy.ts admin-gated, 20/hr rate-limited)
  │
  ▼
parse multipart formData
  │  validate: file present, size ≤ 10 MB, mime ∈ {png/jpeg/webp}, alt ≤ 125 chars
  ▼
read bytes → Buffer
  │
  ▼
compressImageIfOverCap(buffer, mime, 500 KB)   ← [[image-pipeline]]
  │  pass-through if ≤ 500 KB
  │  else quality ladder (85→60), else resize ladder (2000w→1200w)
  │  throws CompressionFloorError if both exhaust
  ▼
imageSize(compressed buffer) → { width, height }
  │
  ▼
sha256(compressed buffer) → checksum
  │
  ▼
putToR2(key: `blog/{slug}/{slug}-featured-01.{ext}`, body: compressed buffer)
  │  immutable cache headers
  ▼
UPDATE post SET (11 image columns + updatedAt) WHERE id = ?
  │  og_image_path, og_image_alt, og_image_width, og_image_height,
  │  og_image_filename, og_image_mime_type, og_image_size_kb,
  │  og_image_uploaded_by, og_image_uploaded_at, og_image_checksum,
  │  og_image_r2_key, og_image_deleted_at: null
  ▼
return refreshed post → admin UI updates preview + soft-warn if final > 150 KB
```

## Validation layers (defence in depth)

| Layer | Check | Failure mode |
|---|---|---|
| Client form | alt non-empty, size ≤ 10 MB | red error in toast |
| Server route | file present, size ≤ 10 MB, mime ∈ set, alt ≤ 125 | 400 with clear user message |
| Compression pipeline | output ≤ 500 KB OR throws | CompressionFloorError → 400 "resize the original" |
| DB CHECK | `og_image_size_kb <= 500`, mime ∈ set | drizzle/0016_post_og_image_metadata.sql |
| Rate limit | 20 uploads/hr per IP | 429 with Retry-After |

The DB CHECK at 500 KB is now satisfied by the compression pipeline rather than by rejecting the upload. See [[2026-05-24-validation-without-normalization]] for the lesson that drove the change.

## Files

- [route](../../app/api/admin/posts/%5Bid%5D/image/route.ts) — PUT + DELETE handlers
- [post-form](../../app/admin/(authed)/blog/posts/post-form.tsx) — admin form + drag-drop UI
- [image-pipeline](../../lib/image-pipeline.ts) — server-side Sharp compression
- [r2](../../lib/r2.ts) — Cloudflare R2 S3-compatible client
- [schema](../../lib/db/schema.ts) — 11 og_image_* columns + CHECK constraints
- [migration](../../drizzle/0016_post_og_image_metadata.sql) — CHECK constraints
- [tests](../../lib/image-pipeline.test.ts) — pipeline unit tests

## Failure modes

| Codepath | Failure | Surface |
|---|---|---|
| Pre-compression ceiling | size > 10 MB | 400 "Image too large — max 10 MB" |
| Sharp decode | corrupt bytes / `limitInputPixels` violation | 400 "Could not process image" |
| Compression floor | quality + resize ladders both exhausted | 400 "Image cannot be compressed below the size limit — please resize the original first" |
| R2 put | network / bucket misconfigured | 502 "Upload failed — try again" |
| R2 not configured | env vars missing | 503 with config-error message |
| DB update post-R2 | rare race / connection drop | 500 "Saved to R2 but DB update failed" (R2 has orphan object) |
| Rate limit | >20 in an hour from same IP | 429 with Retry-After header |

## Open behaviours worth knowing

- **Checksum is over the compressed bytes**, not the original input. Dedupe semantics (if ever added) need to account for this.
- **Soft-delete** preserves `og_image_path` so a grace period lets external caches expire. A future cleanup job will null + reap.
- **No image processing on read** — public render uses Next/Image on the same R2 URL.
