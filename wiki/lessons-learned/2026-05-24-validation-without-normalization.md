---
title: "Lesson: validation without normalization is half a feature"
category: lessons-learned
created: 2026-05-24
updated: 2026-05-24
related: [[blog-featured-image-upload]], [[image-pipeline]]
---

## Problem

The blog featured-image upload pipeline shipped strict size validation (500 KB hard cap at three layers: client form, server route, DB CHECK) AND strict MIME validation (`{png, jpeg, webp}` only, at the server route AND DB CHECK) but no compression and no format normalization. A 2,120 KB PNG dropped into the admin form produced a red "Image too large (2120 KB) — max 500 KB" error and went no further. The user — me — had no recourse in-flow: I had to leave the admin UI, open an external compression tool, find one that produced sub-500-KB output without visible quality loss, then come back and re-upload.

Then once the size fix shipped, the same Midjourney download (saved with a `.png` extension, identified as `image/png` by the OS file manager) got rejected with "Unsupported image type — use PNG, JPEG, or WebP." The browser's `File.type` field was sending something else (empty, or a non-standard MIME — Linux + content-negotiated AI image serving is a tricky combination) and the route was trusting that field over the actual file bytes.

Two block walls, same root cause: validation built on top of fields the user can't control, with no normalization layer to bridge the gap.

The validations were *correct* (the DB CHECKs exist for legitimate reasons: read-side page-load budgets, image-render performance, R2 bandwidth, and a stable rendering MIME set) but *incomplete*. Validation tells the user "this isn't allowed." Normalization makes "what isn't allowed" something the server can fix automatically.

## Fix

Added [lib/image-pipeline.ts](../../lib/image-pipeline.ts) — server-side Sharp-based **format detection + transcoding + compression**, in one module. The pipeline:

1. Reads the actual format from magic bytes via Sharp's `metadata()` (ignores the browser's `File.type` entirely — magic bytes are the source of truth).
2. Maps the detected format to an output MIME: `{png, jpeg, webp}` persist as-is; `{avif, heif, gif, tiff}` transcode to WebP; anything else throws `UnsupportedFormatError`.
3. Runs a deterministic quality ladder (q85 → q60) followed by a resize ladder (2000w → 1200w) until the buffer fits the 500 KB DB cap. Throws `CompressionFloorError` if both exhaust.

Decompression-bomb-guarded via `limitInputPixels: 50_000_000`. Wired into [the upload route](../../app/api/admin/posts/%5Bid%5D/image/route.ts) which now does no MIME validation of its own — Sharp is canonical. Raised the pre-compression client + server ceiling to 10 MB. The 500 KB and MIME DB CHECKs both stay in place and are now guaranteed by the pipeline rather than enforced via upload rejection.

The 2,120 KB PNG compresses to ~280 KB before the R2 put. The Midjourney upload (whatever its actual underlying format) now succeeds because Sharp detects it correctly regardless of what the browser reports.

## Rule

**Validation without normalization is half a feature.**

When you ship validation that rejects inputs the user will realistically produce, you owe them the normalization step that makes those inputs succeed. Every modern CMS (WordPress, Ghost, Medium, Substack) accepts what users upload and optimizes server-side. The conventional wisdom is the right wisdom here. If the validation is correct but the rejection rate against real-world inputs is high, the feature is half-built — finish it.

### How to apply

- When designing any upload / form / API surface that enforces a numeric or shape constraint, ask: *"What's the normalization step that lets oversized / wrong-shape / wrong-format inputs succeed instead of failing?"*
- If the answer is "no, this constraint is load-bearing and we want the user to fix their input upstream," document why explicitly — that's a deliberate trade-off, not a default.
- Common examples: image upload size, text length truncation (vs hard reject), email normalization (lowercase, strip whitespace), URL canonicalization, currency rounding.
- Library to reach for in this stack: Sharp is already a transitive dep of Next.js, so it's free to elevate to a direct dependency for any image normalization.

### Secondary rule: don't trust client-reported metadata for validation when you can derive it server-side

The browser's `File.type` was the proximate cause of the second failure. It's user-controlled in the sense that the user can't fix it — it depends on browser, OS, file manager, drag source, content-negotiation history — but it's also not authoritative in any meaningful sense. The file bytes themselves are. If you have the bytes, validate against the bytes. Treat the client-reported value as a hint, not a contract. This applies beyond images: filename extensions, character encodings, declared content-types on multipart uploads, even self-reported user agents.

### Anti-pattern to avoid

Don't add normalization that silently corrupts data. If JPEG q60 produces visible banding on user-uploaded screenshots, that's a regression in user trust. The pipeline must either succeed within a defined quality envelope or throw and let the user see the failure with a recovery action ("please resize the original first"). Silent quality loss is worse than a clear rejection.
