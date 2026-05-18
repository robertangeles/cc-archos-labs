---
title: About page — May 2026 CEO review + locked decisions
category: decision
created: 2026-05-18
updated: 2026-05-18
related: [[about-page]], [[about-page-section-components]], [[home-page-section-components]], [[2026-05-17-home-page-pas-rewrite]], [[integration-config]], [[index]]
---

The four locked decisions out of the `/plan-ceo-review` of the About page draft on 2026-05-18. Full review record at `~/.claude/plans/next-isd-we-wil-majestic-pillow.md` (external). Mode: SCOPE EXPANSION.

## Context

The Home page PAS rewrite shipped 2026-05-17 (PR #53) and componentised 10 reusable section primitives in `components/sections/home/`. About is the next public-facing page — a credibility surface that grounds the home page's claims in a named practitioner and a stated philosophy. The draft prose (`About us.pdf`, May 2026) was strong; the review's job was execution rigor, not rewriting.

## D1 — Implementation approach: new `components/sections/about/` family

Three approaches considered: (A) reuse all home primitives + small Hero generalisation, (B) build About-specific primitives, (C) inline JSX. Picked B.

Rationale: bio-specific layouts (photo + credentials chip row, pull-quote on the philosophy, numbered steps on Way of Working) are different in kind from the home page's evidence/offering vocabulary. The new primitives are also intended for downstream reuse on the Consulting page (services overview + practitioner manifest), Modelling Room landing (newsletter intro + bio), and any future founder-led page. Matches the "design properly now beats ship-then-refactor" override.

Components introduced (see [[about-page-section-components]]):
- `<PersonCard>` — photo + name/role + bio + credentials + outbound trust links
- `<PhilosophyBlock>` — pull-quote-led prose with optional secondary quote
- `<WayOfWorkingSteps>` — sequential numbered steps
- `<SelectedWorkCard>` — anonymised receipt card with optional link slot

Reused from home: `<Hero>` (with `cta` prop now optional — see D3), `<Section>`, `<CtaPair>`, `<AnchorNav>`, `<StickyMobileCta>`.

## D2 — Review mode: SCOPE EXPANSION

The draft was good. We went big anyway. Eight expansion proposals were surfaced and all accepted:

1. Schema.org Person JSON-LD + OG card + Twitter card — `buildAboutPagePersonLd()` in `lib/schema-org.ts`; `app/about/opengraph-image.tsx`; metadata wired via `buildPageMetadata`.
2. Anchor IDs on every section + desktop anchor nav under the hero — `#the-person`, `#selected-work`, `#the-philosophy`, `#way-of-working`, `#book-a-call`.
3. Sticky mobile CTA bar — reuses `<StickyMobileCta>` with `hideWhenSelector="#book-a-call"`.
4. Pull-quote treatment on "The model was never the constraint." — display-md / display-lg lead in `<PhilosophyBlock>`.
5. Photo block — placeholder ships, swap-in via single constant.
6. `?name=` print personalisation — reuses `lib/sanitise-name.ts`.
7. Selected Work strip — 3 anonymised case cards between Person and Philosophy.
8. LinkedIn + Modelling Room outbound trust links — drives `Person.sameAs`.

## D3 — Hero CTAs: OMIT

The home page hero has CTAs under the headline. The About hero does not. Rationale: the Person → Selected Work → Philosophy → Way of Working sequence is the funnel for a sceptical reader; CTAs at the end is the right pacing for a trust-building page. The bottom `<CtaPair>` + the sticky mobile bar carry the conversion load.

Implementation effect: `<Hero>`'s `cta` prop becomes optional. The home page still passes one; future pages (Consulting, Modelling Room) can omit. Backward-compatible change to a shared component.

## D4 — Selected Work positioning: BETWEEN Person and Philosophy

Final section order: **Hero → Person → Selected Work → Philosophy → Way of Working → CTA.**

Rationale: receipts after the bio is how essays + bios work. Prove the practitioner before talking about how the practitioner thinks. Also the strongest scroll-stopping moment for a scanner — "oh, this person has actually done it" — at the point in the funnel where scepticism is highest.

## Additional config change

`modellingRoomUrl` field added to `SiteSettings` schema (`lib/site-config-shared.ts`) and to the admin form at `/admin/site`. LinkedIn URL was already settings-driven via `founderLinkedinUrl`. Both URLs flow into `<PersonCard>` outbound trust links and the Person JSON-LD `sameAs` array. Empty strings render gracefully — links omitted, schema entries filtered.

Pattern reinforced: anything Rob may want to change without dev help lives in `site_setting`. See [[integration-config]] for the config tier hierarchy.

## What's deferred (in TODOS, not this PR)

- Workspace photo replacement (swap `PHOTO_SRC` constant when Rob has a photo)
- Case-study pages (`/case-studies/[slug]`) — `<SelectedWorkCard>`'s `href` slot is reserved
- Outbound LinkedIn / Modelling Room click analytics events

## What's deliberately out of scope

Case studies, video walk-throughs, dated "currently advising" proof block, endorsements, sector logos. All would require external assets or maintenance overhead that does not earn its complexity yet.
