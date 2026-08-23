---
title: Watermark Remover
category: entity
created: 2026-08-23
updated: 2026-08-23
related: [[2026-08-23-watermark-remover-cta-removed]], [[deployment-architecture]]
---

Free client-side tool at `/tools/watermark-remover` that strips invisible AI-provenance signals from text and images — nothing ever leaves the browser.

## What it does

- **Text mode**: strips 12 named invisible-Unicode code points (zero-width space, bidi controls, variation selectors, the Unicode tag block, etc.) live as you type, or paste/drop a `.txt`/`.md` file (read via `Blob.text()` — raw UTF-8 decode, so only plain-text formats work). `lib/text-metadata.ts`.
- **Image mode**: hand-rolled JPEG/PNG marker-segment parsers strip EXIF, XMP, and C2PA/JUMBF content-credential manifests, preserving only the EXIF orientation tag (so photos don't come out rotated). `lib/image-metadata/{jpeg,png}.ts`.
- Everything runs `Uint8Array`-in/`Uint8Array`-out in the browser — no upload, no server data path, nothing logged.

## Where it lives

- Route: `app/tools/watermark-remover/page.tsx`
- Orchestrator: `watermark-remover-client.tsx` (state machine, decode-verify before showing success)
- Parsers: `lib/text-metadata.ts`, `lib/image-metadata/`
- Analytics: `lib/watermark-analytics.ts` — allowlisted shape only (event name, source, count, boolean), enforced by a type with no index signature so an extra field fails `tsc`, not just a test
- Design doc: `docs/designs/watermark-remover.md` — approaches considered, premises, full review history, and a **Post-Ship Corrections** section for decisions made after the design doc's own review passes closed
- Tests: unit + fuzz (`lib/**/*.test.ts`), Playwright E2E (`tests/e2e/watermark-remover.spec.ts`)

## Known gaps

- **No conversion mechanism.** The original design named a persistent CTA into `/consulting` as this tool's sole lead-gen path (deliberately no registration gate, to match the "we never see your content" trust pitch). The CTA was removed 2026-08-23 as ineffective/inconsistent with the trust positioning — see [[2026-08-23-watermark-remover-cta-removed]]. The tool currently has zero path back to the consulting track.
- **No .docx/.pdf/.doc support in text mode** — deliberate, not an oversight. `Blob.text()` raw-decodes bytes as UTF-8, which only works for actual plain text; `.docx` (ZIP+XML), legacy `.doc` (binary OLE), and `.pdf` (compressed binary + font encoding tables) would all decode to garbage, not real content. `.docx` is plausible to hand-roll later (ZIP central-directory parsing + XML text extraction, consistent with this tool's existing "no third-party library" architecture); `.pdf` realistically needs a library like pdf.js, which breaks that architecture — not worth it without real demand. Deferred until someone asks (2026-08-23).
