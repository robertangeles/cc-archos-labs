---
title: Design system — implementation reference
category: concept
created: 2026-05-15
updated: 2026-05-15
related: [[transactional-email-rendering]]
---

How the Linear-themed brand spec at `DESIGN.md` (project root) is wired into the codebase. DESIGN.md is the **spec** (what the brand looks like). This page is the **implementation reference** (how the codebase encodes it).

## The two files that matter

- **`DESIGN.md`** — root of the project. Frontmatter holds the canonical token values (colours, typography, radii, spacing). Free-form sections explain the design rationale. This is the source of truth for "what should the brand look like."
- **`app/globals.css`** — `@theme` block declares every token as a CSS custom property. Tailwind v4 reads `@theme` and generates utility classes by token name. This is the source of truth for "what utility classes exist."

If they ever drift, DESIGN.md wins on the spec and globals.css wins on what's actually shipped. The PR that updates one should update the other.

## Token architecture

### Colour tokens (`@theme` block in globals.css)

| Group | Tokens | Notes |
|---|---|---|
| Brand | `primary`, `primary-hover`, `primary-focus`, `on-primary`, `brand-secure` | Lavender `#5e6ad2` family. Used ONLY on brand mark, primary CTA, focus ring, link emphasis. Never decoratively. |
| Surface ladder | `canvas`, `surface-1`, `surface-2`, `surface-3`, `surface-4` | Four-step lift from canvas (#010102 → #191a1b). Modal panels + selected nav items = `surface-2`. Default cards = `surface-1`. |
| Inverse surfaces | `inverse-canvas`, `inverse-surface-1`, `inverse-surface-2`, `inverse-ink` | Light-palette parallel for transactional surfaces (print, email). |
| Text hierarchy | `ink`, `ink-muted`, `ink-subtle`, `ink-tertiary` | Four-step contrast ladder. `ink` for headings + emphasis, `ink-subtle` for secondary body, `ink-tertiary` for disabled. |
| Hairline | `hairline`, `hairline-strong`, `hairline-tertiary` | Three-step 1px-border scale. `hairline` for default panel borders, `hairline-strong` for input focus + emphasized borders. |
| Semantic | `semantic-success`, `semantic-error`, `semantic-warning`, `semantic-high`, `semantic-overlay` | Used sparingly. Success = #27a644 (status pills), error/warning/high = red/amber/orange (form validation, risk-flag callouts in reports). |

### Typography tokens

13 named type tokens, each bundling size + line-height + letter-spacing + font-weight:

```
display-xl    80px / 600 / 1.05 / -3.0px
display-lg    56px / 600 / 1.10 / -1.8px
display-md    40px / 600 / 1.15 / -1.0px
headline      28px / 600 / 1.20 / -0.6px
card-title    22px / 500 / 1.25 / -0.4px
subhead       20px / 400 / 1.40 / -0.2px
body-lg       18px / 400 / 1.50 / -0.1px
body          16px / 400 / 1.50 / -0.05px
body-sm       14px / 400 / 1.50 / 0
caption       12px / 400 / 1.40 / 0
button        14px / 500 / 1.20 / 0
eyebrow       13px / 500 / 1.30 / +0.4px (positive — taxonomy marker)
mono          13px / 400 / 1.50 / 0
```

Tailwind v4 generates `text-display-xl`, `text-headline`, `text-eyebrow` etc. — each utility applies all four properties at once. Never combine `text-body` with `tracking-[...]` or `leading-[...]` — the token already encodes those.

### Font stack

- **`--font-sans`** = `var(--font-geist-sans), system-ui, -apple-system, sans-serif`
- **`--font-mono`** = `var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace`

Both load via `next/font/google` in `app/layout.tsx` (self-hosted at build time, no third-party request at runtime). DESIGN.md §347 lists Geist Sans as a viable substitute for Linear's proprietary display + text faces — closer to Linear's voice than Inter on display sizes.

## Transactional surfaces (print + email)

`.pdf-mode` and `@media print` in globals.css override the colour tokens for transactional surfaces:

- Canvas + surfaces flip to a light palette (white + off-white tiers)
- Ink hierarchy flips to dark-on-light
- Hairlines flip to light grey scale
- Primary stays lavender but `primary-hover` + `primary-focus` step toward darker variants for white-background contrast

Email templates in `lib/email-templates.ts` and `lib/booking-emails.ts` use hardcoded hex values (light-themed) rather than CSS variables — they can't reach into `globals.css` at render time and email clients can't reliably load custom fonts. The lavender accent (`#5e6ad2`) is the only token-aware value in those files; everything else is a system font stack + brand-light palette.

## Rules of thumb (the why-don't-just-use-the-token gotchas)

- **Lavender is scarce.** If you reach for `bg-primary` / `text-primary` outside of CTAs, focus rings, links, or the brand mark — stop. Use `bg-surface-2`, `text-ink-subtle`, `border-hairline-strong`, or a semantic token instead.
- **The 4-step surface ladder carries depth, not shadows.** Don't add `shadow-*` to elevate a card; bump it from `surface-1` to `surface-2`.
- **Type tokens bundle four properties.** `text-display-xl` already applies `tracking-[-3px]` and `leading-[1.05]`. Don't compose with additional `tracking-`/`leading-` utilities — that breaks the spec.
- **Eyebrow uses positive tracking.** Every other display/body token uses negative or zero tracking. Eyebrow's `+0.4px` is deliberate.
- **Semantic tokens are for state, not decoration.** `semantic-success` for the admin Saved badge, contact-form Message-Sent callout. `semantic-error/warning/high` for risk-flag callouts on the report and form validation. Never for general accent.

## Where things live

| Concern | File |
|---|---|
| Brand spec (the source of truth) | `DESIGN.md` |
| Token declarations + print overrides | `app/globals.css` |
| Font loading | `app/layout.tsx` (`Geist`, `Geist_Mono` from `next/font/google`) |
| Reusable UI primitives | `components/ui/` (Button, Pill, Dialog, Field, etc.) |
| Transactional surface palette | `lib/email-templates.ts`, `lib/booking-emails.ts`, the `.pdf-mode` + `@media print` blocks in globals.css |
| OpenGraph card | `app/opengraph-image.tsx` (uses next/og — Inter internally, lavender accent dot) |

## How a new design token gets added

1. Update the colour palette / typography table in `DESIGN.md` if it's a new brand value.
2. Add the CSS custom property to the `@theme` block in `app/globals.css` (or `@theme inline` for tokens that reference other variables).
3. **Touch globals.css again** to force a Tailwind v4 recompile — hot-reload doesn't always pick up new token NAMES (values do hot-reload). Documented in `wiki/lessons-learned/2026-05-07-tailwind-v4-new-utilities.md`.
4. If the token has a different value in the transactional path, add the override inside both `.pdf-mode` and `@media print` blocks.
5. Use the generated utility (`bg-X`, `text-X`, `border-X`, `text-display-X` for type) — never reach into `var(--color-X)` directly in JSX.

## How the design pass landed (historical reference)

The current design system was built in a five-PR pipeline over 2026-05-15:

- **D1 (#34)** — colour tokens + accent swap from Tailwind blue to Linear lavender
- **D2 (#35)** — 13-token typography scale + high-frequency drift fixes
- **D3 (#36)** — decorative accent cleanup + surface ladder escalation
- **D4 (#37)** — semantic colours tokenised (no visual change, pure cleanup)
- **D5 (#38)** — font swap from Inter to Geist Sans + Geist Mono

The staged approach paid off: D3 fixed "decorative lavender bleed" that only became obvious AFTER D1 swapped the hue. A single mega-PR would have compounded the issue and made review impossible. The plan document at `~/.claude/plans/linear-twirling-quilt.md` captures the sequencing decisions.

## What this concept page does NOT cover

- Per-page composition decisions (hero layout, card grid count, section padding) — those live in the JSX of `app/page.tsx` etc.
- Animation / motion design — currently Framer Motion is used in a few places (`registration-gate`, `welcome-screen`, `progress-bar`) but DESIGN.md doesn't specify motion tokens. Out of scope until a motion spec lands.
- Responsive breakpoints — Tailwind defaults are used (sm/md/lg/xl). DESIGN.md §504-525 documents the breakpoint behaviour at a spec level.
- Visual regression testing — currently relies on `scripts/screenshot.mjs` (Playwright) for spot checks. A Percy-style continuous visual diff is future work.
