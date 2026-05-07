---
title: Brand foundation — typography and colour tokens
category: decision
created: 2026-05-07
updated: 2026-05-07
related: [[backlog]], [[index]]
---

Adopted Source Serif 4 (heads) + Inter (body) with monochrome editorial palette accented by ink blue. Tokens defined via Tailwind v4 `@theme` in `app/globals.css`; fonts loaded via `next/font/google` in `app/layout.tsx`.

## Decision

**Typography**
- Heads: Source Serif 4 (`--font-source-serif`, exposed as `font-serif` utility)
- Body: Inter (`--font-inter`, exposed as `font-sans` utility)
- Both loaded via `next/font/google` with `display: swap` and Latin subset only

**Colour palette**
| Token | Hex | Purpose |
| --- | --- | --- |
| `--color-ink` | `#0a0a0a` | Primary text |
| `--color-paper` | `#fafaf9` | Background (warm off-white) |
| `--color-accent` | `#0f1f4d` | CTAs, links (ink blue) |
| `--color-muted` | `#6b6b6b` | Secondary text |
| `--color-rule` | `#e5e5e5` | Hairlines, dividers |

Tailwind v4 generates corresponding utilities automatically: `bg-paper`, `text-ink`, `text-muted`, `text-accent`, `border-rule`, etc.

**Spacing + sizing**
- Tailwind v4 defaults retained (no override). The default 4px-based scale is sufficient.
- Typographic scale uses Tailwind defaults (`text-5xl`, `text-6xl`, `text-lg`, etc.).

## Reasoning

Brand positioning per CLAUDE.md is "the practitioner alternative to Big Four — direct, honest, no corporate speak." This rules out:
- Corporate blue palettes (looks like every consultancy)
- Geometric sans throughout (looks like every tech startup)
- Heavy decorative elements (CLAUDE.md: "typography does the heavy lifting — not decorations")

Editorial serif + clean sans says "we have something to say and we know how to say it" — closer to a trade publication (Stratechery, Bloomberg, The Economist) than a SaaS landing page. Reads as confident without shouting.

Monochrome with a single restrained accent forces every visual decision to earn its place. Easy to ship; hard to make ugly. Aligns with CLAUDE.md UI principle: "When in doubt, remove."

Ink blue (#0f1f4d) chosen over corporate blue (e.g. #2563eb) because it reads as serious/editorial rather than tech-bro. Used only on interactive elements (links, primary CTAs) so it functions as a wayfinding signal, not decoration.

## Verification

Item 1 of `wiki/backlog/backlog.md` Phase 0 verifies as: "a single styled `<h1>` + paragraph on `/` reflects the system."

Verified 2026-05-07 via `node scripts/screenshot.mjs` at desktop (1280x800) and mobile (390x844) viewports. Computed styles confirmed:
- `body { background: rgb(250, 250, 249); color: rgb(10, 10, 10); font-family: Inter ... }`
- `h1 { color: rgb(10, 10, 10); font-family: Source Serif 4 ...; font-size: 60px (md+) / 48px (mobile) }`
- `a { color: rgb(15, 31, 77); text-decoration-color: ~30% opacity accent }`

No silent fallbacks. Tokens resolve correctly. Responsive breakpoints work as specified.

## Implementation files

- `app/layout.tsx` — font registration + body tokens
- `app/globals.css` — `@theme` token block
- `next.config.ts` — `turbopack.root` set to `__dirname` (required to avoid Turbopack misidentifying workspace root after dependency installs; see `wiki/lessons-learned/`)
- `scripts/screenshot.mjs` — Playwright verification harness used by every UI-changing task per CLAUDE.md "Every user-facing feature needs to be tested using Playwright"

## What this does NOT decide

- Dark mode (deferred — editorial brand defaults to light)
- Iconography (no decision yet — likely defer to a single line-icon set if needed)
- Imagery (CLAUDE.md mandate: no stock photos; case-by-case)
- Heading scale beyond Tailwind defaults (will refine if a layout demands it)
