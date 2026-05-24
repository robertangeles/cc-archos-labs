---
title: "Lesson: validation without normalization is half a feature"
category: lessons-learned
created: 2026-05-24
updated: 2026-05-24
related: [[blog-featured-image-upload]], [[image-pipeline]]
---

## Problem

The blog featured-image upload pipeline shipped strict size validation (500 KB hard cap at three layers: client form, server route, DB CHECK) but no compression. A 2,120 KB PNG dropped into the admin form produced a red "Image too large (2120 KB) — max 500 KB" error and went no further. The user — me — had no recourse in-flow: I had to leave the admin UI, open an external compression tool, find one that produced sub-500-KB output without visible quality loss, then come back and re-upload. The block sat for long enough that I noticed it as a recurring publishing friction, not a one-off.

The validation was correct (the DB CHECK exists for legitimate reasons: read-side page-load budgets, image-render performance, R2 bandwidth) but it was *incomplete*. Validation tells the user "this isn't allowed." Normalization makes "what isn't allowed" something the server can fix automatically.

## Fix

Added [lib/image-pipeline.ts](../../lib/image-pipeline.ts) — server-side Sharp-based compression with a deterministic quality ladder (q85 → q60) followed by a resize ladder (2000w → 1200w). Sharp is decompression-bomb-guarded via `limitInputPixels: 50_000_000`. Wired into [the upload route](../../app/api/admin/posts/%5Bid%5D/image/route.ts) between buffer read and dimension calculation. Raised the pre-compression client + server ceiling to 10 MB so realistic photo exports get accepted; the 500 KB DB CHECK stays in place and is now guaranteed by the pipeline.

The 2,120 KB PNG now compresses to ~280 KB before the R2 put. The admin sees a green success toast with the post-compression size.

## Rule

**Validation without normalization is half a feature.**

When you ship validation that rejects inputs the user will realistically produce, you owe them the normalization step that makes those inputs succeed. Every modern CMS (WordPress, Ghost, Medium, Substack) accepts what users upload and optimizes server-side. The conventional wisdom is the right wisdom here. If the validation is correct but the rejection rate against real-world inputs is high, the feature is half-built — finish it.

### How to apply

- When designing any upload / form / API surface that enforces a numeric or shape constraint, ask: *"What's the normalization step that lets oversized / wrong-shape / wrong-format inputs succeed instead of failing?"*
- If the answer is "no, this constraint is load-bearing and we want the user to fix their input upstream," document why explicitly — that's a deliberate trade-off, not a default.
- Common examples: image upload size, text length truncation (vs hard reject), email normalization (lowercase, strip whitespace), URL canonicalization, currency rounding.
- Library to reach for in this stack: Sharp is already a transitive dep of Next.js, so it's free to elevate to a direct dependency for any image normalization.

### Anti-pattern to avoid

Don't add normalization that silently corrupts data. If JPEG q60 produces visible banding on user-uploaded screenshots, that's a regression in user trust. The pipeline must either succeed within a defined quality envelope or throw and let the user see the failure with a recovery action ("please resize the original first"). Silent quality loss is worse than a clear rejection.
