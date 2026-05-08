---
title: Linear-quality redesign — dark theme, Inter, 8pt grid
category: decision
created: 2026-05-07
updated: 2026-05-07
related: [[2026-05-07-brand-foundation]], [[2026-05-07-layout-shell]], [[2026-05-07-home-page]], [[backlog]], [[index]]
---

Replaced the editorial light brand foundation with a Linear.app-quality dark theme. Inter throughout (Source Serif 4 removed). Strict 8pt grid spacing, 1080px max content width, sticky transparent header that gains backdrop blur on scroll, blue (#3B82F6) as the wayfinding accent.

This decision **supersedes** the three previous Phase 0a decisions: [[2026-05-07-brand-foundation]], [[2026-05-07-layout-shell]], [[2026-05-07-home-page]]. They remain as historical record of the editorial direction we explored first.

## Why supersede

The editorial direction (Source Serif 4 + monochrome paper) was ambitious — a trade-publication aesthetic that signalled depth via typography. After review, Rob asked for Linear.app standard instead: dark, technical, restrained motion, accent-driven wayfinding, 8pt grid discipline. The editorial direction is plausible for a thought-leadership publication (the future Modelling Room page might revisit it) but reads less like a senior practitioner's product practice and more like a Bloomberg op-ed. Linear-quality reads as "this person ships software."

## Tokens (Tailwind v4 `@theme` in `app/globals.css`)

| Token | Hex | Tailwind utility | Purpose |
| --- | --- | --- | --- |
| `--color-canvas` | `#0F0F0F` | `bg-canvas` | Page background; near-black, not pure |
| `--color-surface` | `#18181B` | `bg-surface` | Elevated sections (zinc-900) |
| `--color-fg` | `#F5F5F5` | `text-fg` | Primary text; near-white |
| `--color-muted` | `#A1A1AA` | `text-muted` | Secondary text; zinc-400 |
| `--color-accent` | `#3B82F6` | `bg-accent`, `text-accent`, `border-accent` | CTAs, links, the "fail" word, eyebrow labels (blue-500) |
| `--color-accent-hover` | `#2563EB` | `hover:bg-accent-hover` | Button hover state (blue-600) |
| `--color-rule` | `#27272A` | `border-rule`, `divide-rule` | Borders, hairlines (zinc-800) |

Five of the seven values match Tailwind defaults exactly (`zinc-800/900`, `blue-500/600`); `canvas` (#0F0F0F) sits between `zinc-900` and `zinc-950` and is intentionally custom per spec.

Token names changed from the editorial set: `paper → canvas`, `ink → fg` (semantics inverted: fg is now light, bg is dark), `surface` is new. Names are now neutral (`fg`, `canvas`) rather than physical-medium metaphors (`ink`, `paper`) — the metaphors broke once the theme inverted.

## Typography

- **Inter only.** `next/font/google` Inter variable font. Source Serif 4 removed entirely from `app/layout.tsx` and from any `font-serif` references in components.
- **No `--font-serif` token.** Removed from `globals.css`.
- Sizes (set via arbitrary Tailwind values where Tailwind defaults don't match the spec):
  - H1: `md:text-[64px]` (64px), font-semibold, `tracking-[-0.03em]`, `leading-[1.1]`
  - H2 (closing CTA): `md:text-[40px]` (40px), font-semibold, `tracking-[-0.02em]`
  - Eyebrow labels (semantically h2): `text-[13px]`, font-medium, uppercase, `tracking-[0.08em]`, `text-accent`
  - H3 (cards): `text-xl` (20px), font-medium
  - Body: `text-base` (16px), `leading-[1.7]`, `text-muted`

Mobile h1 steps down to `text-4xl` (36px), h2 to `text-3xl` (30px). Spec is desktop-first; mobile scales per CLAUDE.md mobile-first mandate.

## Spacing — 8pt grid, strict

- Section padding: `py-32` (128px) top and bottom on every section
- Container horizontal padding: `md:px-12` (48px) on desktop; mobile keeps `px-6` (24px) for breathing room at narrow viewports
- Component gap: `md:gap-12` (48px), `gap-6` (24px) on mobile
- Element gap (tight stacks): `gap-x-3`, `space-y-4` (16px), etc.
- Max content width: `max-w-[1080px]` on every section's inner container

## Hero specifics

- **Eyebrow pill:** "AI Transformation Practice", `border border-accent`, `rounded-full` (≈100px radius), uppercase 13px, blue text and border
- **Headline:** "Most AI programs **fail** before the model arrives." — the word `fail` wrapped in `<span className="text-accent">` so it renders blue. Forced 2-line break on `sm+` via `<br className="hidden sm:inline" />`; mobile wraps naturally.
- **Subheadline:** Single paragraph (was two in the editorial draft), max-width 560px, centered.
- **Background gradient:** `radial-gradient(ellipse at 50% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 70%)` painted by an `aria-hidden absolute inset-0 -z-10` div inside the relative-positioned hero section. The only gradient on the page.
- **CTA button:** `bg-accent text-white px-7 py-3 rounded-md`, `hover:bg-accent-hover`, `transition-colors duration-150`. Repeated identically at hero and closing CTA.

## Header behaviour

`'use client'` component with a scroll listener. Two visual states:
- `scrollY <= 8`: transparent background, transparent bottom border (no visible separator over the hero gradient).
- `scrollY > 8`: `bg-canvas/80 backdrop-blur-md` with a `border-rule` bottom border.

`sticky top-0 z-50` so the header rides the top of the viewport. The 8px threshold avoids flicker at top-of-page.

## Section structure

| Section | Background | Heading element | Notes |
| --- | --- | --- | --- |
| Hero | `bg-canvas` + radial gradient | `<h1>` (centered) | Only h1 on the page |
| What we do | `bg-surface` | `<h2>` styled as eyebrow label | Three article cards in a `md:grid-cols-3` |
| Who we work with | `bg-canvas` | `<h2>` styled as eyebrow label | Two-column built-for/not-for, `md:divide-x md:divide-rule` between |
| Closing CTA | `bg-surface` + `border-y border-rule` | `<h2>` (40px serif weight, centered) | Repeats the hero CTA |
| Footer | `bg-canvas` + `border-t border-rule` | none | Single line: wordmark left, copyright right |

## Card pattern

`rounded-lg` (8px) `border border-rule` `p-8` (32px), `transition-colors duration-150`, `hover:border-accent` for the active-feel hover. No box shadows. Used by the three service-line cards.

The 8px card radius deviates from the global rule's 6px ("Border radius: 6px for cards") because the section-specific spec said `border-radius: 8px`. Section-specific spec wins.

## Filter list bullets

Custom `BlueDot` component: `h-1.5 w-1.5 rounded-full bg-accent` with a `mt-[10px]` to baseline-align with the first line of body copy. Spec said "small blue dot marker" — implemented as an inline span rather than a list-style-type to keep the dot color and position controllable.

## Global rules followed

- **No box shadows anywhere.** Verified by grep — no `shadow-` utilities in any component.
- **One gradient only** (the hero background). All other surfaces are flat fills.
- **All transitions 150ms ease.** Default Tailwind transition timing was overridden via `@theme inline { --default-transition-duration: 150ms; --default-transition-timing-function: ease; }` in `globals.css`. Means anywhere we say `transition-colors`, it's already 150ms ease.
- **Border radius:** 6px (`rounded-md`) for buttons, 8px (`rounded-lg`) for cards, 100px (`rounded-full`) for pills.
- **Pricing absent.** Held from the previous home-page decision — pricing happens in the conversation, not on the page.

## Verification

Verified 2026-05-07 via `node scripts/screenshot.mjs` at desktop (1280x800) and mobile (390x844).

Computed styles match spec exactly:
- `body { background-color: rgb(15, 15, 15); color: rgb(245, 245, 245); font-family: Inter ... }`
- `h1 { font-size: 64px (md+) / 36px (mobile); font-family: Inter }`
- Wordmark `<a>` resolves to `rgb(245, 245, 245)` (text-fg)

Tailwind v4 dev-server gotcha: see [[2026-05-07-tailwind-v4-new-utilities]] — adding net-new utility class names (e.g. `bg-canvas`, `text-fg`) required a re-save of `globals.css` before Turbopack picked them up. The token *values* hot-reloaded fine; the new utility *names* did not.

`pnpm tsc --noEmit` clean.

## What this does NOT decide

- Active-link styling on the nav (deferred until other routes exist).
- Animation/motion beyond the 150ms colour transitions.
- Image strategy (none used; CLAUDE.md prohibits stock).
- Iconography (still none).
- Dark/light mode toggle (the brand is dark-only for now).

## Files changed in this redesign

- `app/globals.css` — token block rewritten
- `app/layout.tsx` — Source Serif 4 import removed; body classes `bg-canvas text-fg`
- `app/page.tsx` — full rewrite
- `components/layout/header.tsx` — `'use client'`, sticky with scroll-state, no `font-serif`
- `components/layout/nav.tsx` — `hover:text-fg`, 150ms duration
- `components/layout/footer.tsx` — single-line footer per spec
