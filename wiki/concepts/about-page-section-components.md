---
title: About page section components
category: concept
created: 2026-05-18
updated: 2026-05-18
related: [[about-page]], [[home-page-section-components]], [[design-system]], [[index]]
---

The four reusable section components introduced for the `/about` page in May 2026. Companion to [[home-page-section-components]] — together the two families are the design system's vocabulary for public-facing content pages. Future pages (Consulting, Modelling Room landing, Tools index) will compose from both.

## Where they live

```
components/sections/about/
├── index.ts                  ← barrel export — import from here
├── person-card.tsx           ← <PersonCard>          (server)
├── philosophy-block.tsx      ← <PhilosophyBlock>     (server)
├── way-of-working-steps.tsx  ← <WayOfWorkingSteps>   (server)
└── selected-work-card.tsx    ← <SelectedWorkCard>    (server)
```

Always import from the barrel (`components/sections/about`). Do not deep-import individual files — same rule as the home family.

## The four components

### `<PersonCard/>` — bio surface

```ts
type SocialPlatform = "linkedin" | "x" | "github" | "huggingface";
type SocialLink = { platform: SocialPlatform; url: string };

type PersonCardProps = {
  name: string;
  role: string;
  paragraphs: string[];
  credentials: string[];
  photoSrc: string | null;       // null → placeholder
  photoAlt?: string;
  socialLinks: SocialLink[];     // [] → icon row hidden
};
```

Two-column grid on `md+` (photo 1fr, bio 2fr), stacked on mobile. Photo slot is intentionally placeholder-tolerant: a hairline-outlined `<figure>` renders with a mono caption ("Workspace photo. Practitioner in context.") when `photoSrc` is `null`. The first paragraph of the bio renders under the name + role; subsequent paragraphs continue in the same `text-body-lg text-ink-subtle` vocabulary. Credentials render as a pill row at the bottom of the bio. The social icon row sits below the credentials with a small "Find Rob" label and one icon per `SocialLink`. Icon components live in `components/icons/social.tsx`; each anchor carries `rel="me noopener"` (the `me` rel reinforces Person identity for IndieAuth/Mastodon verification and reinforces the Schema.org `sameAs` payload) and an `aria-label` derived from the platform name. LinkedIn / X / GitHub render as inline `currentColor` SVGs (lavender on hover); Hugging Face renders the official brand SVG (`/public/images/huggingface_logo-noborder.svg`) as an `<img>` so the yellow brand colour is preserved — the icon row's `hover:bg-surface-1` background lift still telegraphs the interactivity.

### `<PhilosophyBlock/>` — pull-quote-led prose

```ts
type PhilosophyBlockProps = {
  leadQuote: string;
  paragraphs: string[];
  secondaryQuote?: string;
};
```

Lead quote renders at `text-display-md` mobile / `text-display-lg` desktop in full ink — anchor of the section. Supporting prose paragraphs follow in the page-wide `text-justify text-body-lg text-ink-subtle` voice. Optional secondary quote gets a quieter treatment: hairline-strong left border in primary lavender, `text-headline text-ink`.

### `<WayOfWorkingSteps/>` — sequential numbered steps

```ts
type WayOfWorkingStepsProps = {
  steps: { headline: string; body: string }[];
};
```

Vertical `<ol>` on both mobile and desktop. Each step gets a mono `NN / TT` counter (same pattern as the home page `<ServiceCard>`) in the left column on `md+`, with `text-card-title` headline + `text-body-lg text-ink-subtle` body in the right column. Sequential on purpose — a 2-col layout would imply equivalence.

### `<SelectedWorkCard/>` — anonymised receipt

```ts
type SelectedWorkCardProps = {
  label: string;
  outcome: string;
  href?: string;            // optional: future case-study link
};
```

Visually mirrors the home page `<ProofItem>`: surface-1 card with a top-left lavender stroke (48px → 96px on hover) and `text-body-lg text-ink` body. Same stroke convention as the home family — **top-left = evidence (something already happened)**. When `href` is set, the card becomes a `<Link>` (focus ring + same hover treatment). Until case-study pages exist, all cards ship without `href` and render as plain `<article>`s.

## Composition conventions (page-level)

When composing these into a page:

1. Always import from the barrel: `import { PersonCard, … } from "components/sections/about"`.
2. Wrap each in a [[home-page-section-components]] `<Section>` with `id` and `bg` props so anchor nav + surface ladder rhythm stay consistent.
3. Pair them with `<Hero>` and `<CtaPair>` from `components/sections/home/` — they are designed to compose.
4. Copy lives as data — top-of-file consts in the page composition, not inline JSX. Mirrors how `app/page.tsx` does it.
5. No em dashes in user-visible copy (CLAUDE.md voice rule).
6. **Body prose is left-aligned (ragged right), not justified.** Matches the home family convention as of 2026-05-18 — the page-wide `text-justify` rule was retired because narrow columns produced visible word-spacing gaps on mobile. Default `text-align: left`; do not add `text-justify` to any About component.

## Side modules these components depend on

- `next/image` (for `<PersonCard>` photo when supplied)
- `next/link` (for `<SelectedWorkCard>` link variant)
- The shared design tokens in `app/globals.css` `@theme` — no per-component CSS files

## Intended downstream reuse

- **Consulting page** (Phase 1 backlog) will likely reuse `<PersonCard>`-shape for a shorter Rob bio + the home family `<ServiceCard>` for the three service lines.
- **Modelling Room landing** (Phase 3 backlog) will reuse `<PersonCard>` for a short bio block + home family `<Section>` for newsletter teaser content.
- **Tools index** (Phase 3 backlog) does not need this family; it composes from home family only.

## What this family is not for

- Long-form essays / blog posts — typographic content layouts, not card grids.
- Admin / authenticated surfaces — use `components/admin/`.
- Email templates — transactional surfaces have their own light-theme overrides via `app/globals.css` `.pdf-mode`.
