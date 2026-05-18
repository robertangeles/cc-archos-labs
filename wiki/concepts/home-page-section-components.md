---
title: Home page section components — reusable pattern
category: concept
created: 2026-05-18
updated: 2026-05-18
related: [[2026-05-17-home-page-pas-rewrite]], [[design-system]], [[backlog]], [[index]]
---

The 10 reusable section components extracted during the May 2026 home-page PAS rewrite. Pattern is intended for reuse by the Consulting page (Phase 1 backlog), the Modelling Room landing (Phase 3), and the Tools index (Phase 3) so each page composes the same vocabulary instead of rebuilding sections inline.

## Where they live

```
components/sections/home/
├── index.ts              ← barrel export
├── hero.tsx              ← <Hero/>
├── section.tsx           ← <Section/>  (generic container)
├── cta-pair.tsx          ← <CtaPair/>  (client)
├── proof-item.tsx        ← <ProofItem/>
├── service-card.tsx      ← <ServiceCard/>
├── audience-list.tsx     ← <AudienceList/>
├── timeline.tsx          ← <Timeline/>
├── objection-faq.tsx     ← <ObjectionFaq/>
├── anchor-nav.tsx        ← <AnchorNav/>  (client)
└── sticky-mobile-cta.tsx ← <StickyMobileCta/>  (client)
```

When reusing on a new page, import from the barrel (`components/sections/home/index.ts`). Do not deep-import individual files — keeps the surface area predictable.

## The 10 components

### `<Hero/>` — page opener

```ts
type HeroProps = {
  eyebrow: string;
  headline: ReactNode;
  subhead: ReactNode;
  cta: CtaPairProps;
  anchorNav?: AnchorNavProps;   // optional, desktop-only slot under the CTAs
};
```

Centred layout. Lavender radial gradient backdrop. Lavender accent on a single hero verb is the locked treatment (passed in via `headline` as a `<span class="text-primary">…</span>`).

### `<Section/>` — generic container

```ts
type SectionProps = {
  id?: string;                                  // anchor id (used by AnchorNav)
  bg?: "canvas" | "surface-1" | "elevated" | "bordered";
  pad?: "tight" | "relaxed";
  centered?: boolean;
  children: ReactNode;
};
```

Wraps `<section>` with the home-page rhythm constants (max-width `1080px`, `px-6 md:px-12`, `py-12` tight / `py-32` relaxed). Background variants alternate canvas / surface-1 down the page; `elevated` is for the Assessment Block; `bordered` is the Final CTA pattern.

### `<CtaPair/>` — primary + optional secondary buttons (client)

```ts
type CtaPairProps = {
  primary:   { label: string; href: string; microcopy?: string };
  secondary?: { label: string; href: string; microcopy?: string };
  position: "hero" | "assessment-block" | "final" | "sticky-mobile";
  align?: "left" | "center";   // default center
};
```

Primary is lavender-filled; secondary is hairline-outlined. Position tag is the analytics dimension (`cta.assessment.clicked` / `cta.bookcall.clicked` fire with `{ position }`). Microcopy renders as a single caption line below each button. **Convention:** all CTA placements on the home page use `align="center"` (default) — confirmed during PR #53 review.

### `<ProofItem/>` — evidence dossier card

```ts
type ProofItemProps = {
  label: string;
  outcome: ReactNode;
};
```

Surface-1 card with a top-left lavender stroke (48px → 96px on hover). Body promoted to `text-body-lg text-ink` so the proof reads as the protagonist of the card. Used for anonymised customer outcomes.

### `<ServiceCard/>` — practitioner manifest card

```ts
type ServiceCardProps = {
  name: string;
  body: string;
  index: number;          // 1-based sequence number
  total: number;          // total cards in this set
  deliverable: string;    // short tag rendered as a pill on the right of the metadata row
};
```

Surface-1 card with a metadata header (mono `01 / 04` counter + deliverable pill + hairline divider), title in `text-headline`, body in `text-body-lg text-ink`, bottom-left lavender stroke (mirrors the proof card's top-left). Hover: card lifts `surface-1 → surface-2`. Used for offering catalogs.

### `<AudienceList/>` — Built for / Not for column

```ts
type AudienceListProps = {
  variant: "built-for" | "not-for";
  heading: string;
  items: string[];
};
```

Two of these sit side-by-side in a 2-col grid. `not-for` column gets a hairline left-border separator on desktop.

### `<Timeline/>` — milestone bar

```ts
type TimelineProps = {
  milestones: { week: string; label: string }[];
};
```

Horizontal milestone row on desktop, vertical stack on mobile. Each milestone has a lavender dot anchored at the top-left and a hairline horizontal connector to the next item (desktop only). Used to compress a multi-week process into one visual.

### `<ObjectionFaq/>` — disclosure list

```ts
type ObjectionFaqProps = {
  items: { question: string; answer: string[] }[];
};
```

Native `<details>`/`<summary>` — keyboard-accessible by default, no JS required. Each item collapses by default; click reveals the answer paragraphs. `answer` is an array so long answers can carry deliberate paragraph rhythm.

### `<AnchorNav/>` — desktop jump nav (client)

```ts
type AnchorNavProps = {
  items: { label: string; href: string }[];   // href starts with "#"
};
```

Pill-shaped link strip rendered under the hero on desktop (`hidden lg:block`). Fires `anchor.nav.clicked { target }` analytics events.

### `<StickyMobileCta/>` — bottom-fixed dual CTA bar (client)

```ts
type StickyMobileCtaProps = {
  primary:   { label: string; href: string };
  secondary: { label: string; href: string };
  hideWhenSelector?: string;   // defaults to "#final-cta"
};
```

Mobile-only (`md:hidden`). IntersectionObserver auto-hides the bar when the page's Final CTA section enters the viewport, so the floating bar never stacks on top of the in-flow CTA. Honours `prefers-reduced-motion` (drops the slide-in transition); respects iPhone notch via `env(safe-area-inset-bottom)`.

## Composition conventions (page-level)

When a new page reuses these:

1. **Always import from the barrel.** `import { Hero, Section, CtaPair, … } from "components/sections/home"`.
2. **Lavender stays reserved.** Primary CTAs, the brand mark in the hero verb, and the lavender stroke on `ProofItem` / `ServiceCard`. Never decoratively, never as section accents elsewhere.
3. **Cards lift from canvas with `bg-surface-1`.** Sections themselves use `bg="canvas"` or `bg="surface-1"` in alternation; cards always step up one surface level from their containing section. This is what gives the page its rhythm.
4. **Stroke direction tells the reader what the card is.** Top-left stroke = evidence (something already happened). Bottom-left stroke = offering (something we'd build). Don't mix.
5. **Body text uses `text-body-lg text-ink` inside cards** and `text-body-lg text-ink-subtle` outside cards. Cards are where the page promises something; their body deserves full ink. Section-level body is supporting.
6. **Body prose is left-aligned (ragged right), not justified.** Default `text-align: left`; do not add `text-justify`. Earlier home pages used `text-justify` page-wide; that convention was retired on 2026-05-18 because narrow columns (proof grid, service grid, FAQ answers, mobile widths) produced visible word-spacing gaps that read worse than ragged-right. The Agitate and Solution+Proof body blocks, the Assessment Block prose, ProofItem outcomes, ServiceCard bodies, and ObjectionFaq answers all flow left-aligned now.
7. **No em dashes in user-visible copy** per CLAUDE.md voice. Use commas, periods, or restructure. Code comments are fine.

## Side modules these components depend on

- `lib/cta-urls.ts` — `BOOK_A_CALL_URL` + `TAKE_ASSESSMENT_URL` constants
- `lib/analytics.ts` — `track()` function called by `CtaPair`, `AnchorNav`, `StickyMobileCta`
- `components/analytics/analytics-client.tsx` — mount once per page to fire `page.viewed` + `scroll.depth`

## What this pattern is not for

- Long-form content pages (blog posts, wiki) — those want simpler typographic layouts, not card grids
- Admin / authenticated surfaces — use the `components/admin/` family instead
- Email templates — transactional surfaces live under `components/email/` (currently inline in `lib/email/`) with the `.pdf-mode` light-theme overrides from `app/globals.css`
