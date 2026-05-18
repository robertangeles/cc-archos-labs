---
title: About page
category: entity
created: 2026-05-18
updated: 2026-05-18
related: [[about-page-section-components]], [[home-page-section-components]], [[2026-05-18-about-page]], [[design-system]], [[integration-config]], [[index]]
---

The `/about` route — practitioner dossier composed from the home + about section primitives. Anchors Rob Angeles as the credibility surface a sceptical exec lands on before booking a call or starting the assessment.

## Where it lives

- Route: `app/about/page.tsx` (Server Component)
- OG card: `app/about/opengraph-image.tsx` (Next.js convention, returns 1200×630 PNG via `next/og`)
- New section components: [[about-page-section-components]]
- Reused section components: [[home-page-section-components]] — `<Hero>` (with `cta` prop now optional), `<Section>`, `<CtaPair>`, `<StickyMobileCta>`, `<AnchorNav>`
- Person JSON-LD builder: `buildAboutPagePersonLd()` in `lib/schema-org.ts`
- Outbound URLs (LinkedIn + Modelling Room) flow from `site_setting` — admin-editable at `/admin/site`. See [[integration-config]] for the DB-backed-settings pattern.

## Composition

Section order (locked by D4 in the CEO review):

```
Hero               eyebrow + headline (lavender accent on "out loud") + subhead, no CTAs
Section #the-person       PersonCard + bio + optional LinkedIn + Modelling Room links
Section #selected-work    3× SelectedWorkCard (anonymised receipts)
Section #the-philosophy   PhilosophyBlock — "The model was never the constraint." pull-quote led
Section #way-of-working   WayOfWorkingSteps — numbered list
Section #book-a-call      CtaPair (Take the assessment / Book a call)
StickyMobileCta           mobile only; hides on #book-a-call
```

Trust ladder: hook → handshake → proof → belief → method → action. CTAs are intentionally absent from the hero (D3 lock) so the bio earns the click; sticky mobile bar mitigates the long-page scroll-back-up problem.

## Configurable

Everything that may rotate without dev help lives in `site_setting` (per the config tier hierarchy):

| Field                  | Source                          | What it controls                                                  |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `siteName`             | site_setting                    | Brand name in Person JSON-LD `worksFor.name`, OG card top-left    |
| `founderName`          | site_setting                    | Person JSON-LD `name`, PersonCard header, OG card bottom          |
| `modellingRoomUrl`     | site_setting (added 2026-05-18) | Optional newsletter URL; flows into Person JSON-LD `sameAs` only (no PersonCard UI render) |
| `description`          | site_setting                    | meta description fallback (overridden by page-specific value)     |
| OG default image       | site_setting `ogImageUrl`       | Site-wide OG fallback (this page overrides via opengraph-image)   |
| Photo                  | `PHOTO_SRC` const in page.tsx   | Set to `/images/about-me.png`; flip to `null` to fall back to placeholder |
| Social icon row        | `SOCIAL_LINKS` const in page.tsx | 4 platforms: LinkedIn, X, GitHub, Hugging Face. Page-level constant; lift into `site_setting` if/when rotation needs to happen without dev help |
| Selected Work cards    | `SELECTED_WORK` const in page.tsx | 3 anonymised wins; copy lives as data at the top of the page    |
| Bio paragraphs         | `PERSON_BIO_PARAGRAPHS` const   | The 3-paragraph bio                                               |
| Credentials chip row   | `CREDENTIALS` const             | `["CDMP", "Kimball", "Data Vault"]`                               |
| Way of Working steps   | `WAY_OF_WORKING_STEPS` const    | 4 sequential steps with headline + body                           |

Empty `modellingRoomUrl` is filtered out of `sameAs` automatically.

## Print personalisation

`?name=` is sanitised via `lib/sanitise-name.ts` (allow-list: starts with a letter, letters/spaces/hyphens/apostrophes, max 50 chars). When set, a `print-only` header renders at the top of the page reading `Prepared for {name} · Prepared on {DD Month YYYY}`. Mirrors the home page implementation. Use case: Rob prints the page for an in-person board meeting personalised to the attendee.

## SEO / AIEO

The page emits a Schema.org `Person` JSON-LD block as its only page-level structured data. The root `Organization` + `WebSite` schemas (from `app/layout.tsx`) continue to render globally and already include a slim `founder: Person` block — the `/about` Person schema is the canonical, fully populated record that anchors Rob as an entity for LLM citation graphs.

`Person` payload:
- `name` ← `settings.founderName`
- `jobTitle` "Principal Consultant"
- `worksFor` Organization with `name` + `url`
- `url` `{siteUrl}/about`
- `knowsAbout` — 7 domain tags spanning data architecture, AI agent development, lineage, governance, domain modelling, AI readiness, enterprise AI
- `sameAs` — filtered array of `[founderLinkedinUrl, modellingRoomUrl]` (empty strings dropped)

## Analytics

- `page.viewed` fires from `<AnalyticsClient route="/about" />`.
- `cta.assessment.clicked` and `cta.bookcall.clicked` fire from `<CtaPair position="final">` and `<StickyMobileCta>` — position strings stay page-agnostic (`final`, `sticky-mobile`) so downstream queries discriminate by route, not per-page namespacing.
- `anchor.nav.clicked` fires from `<AnchorNav>` with `target ∈ {the-person, selected-work, the-philosophy, way-of-working}`.

## Tests

- Snapshot covers the locked composition (`app/about/page.test.tsx`).
- Unit coverage on the new components — see [[about-page-section-components]].
- Schema.org Person validity covered by a unit test on `buildAboutPagePersonLd`.

## What's deliberately not shipped

- Case-study pages (`/case-studies/[slug]`) — `<SelectedWorkCard>` has an optional `href` slot reserved for these but ships without links. Track via TODOS until two-or-more prospects ask "what was the COBOL project really like?".
- Workspace photo — ships as `null`; placeholder renders the photo intent. Swap in via a single constant change when ready.
- "Currently advising / Recently delivered" dated proof block — deliberately omitted to avoid the maintenance treadmill. Revisit only when there is an automated source.
- Endorsements / quote testimonials — none in scope; add when they exist with permission.
- Sector logos / client logos — Archos Labs deliberately keeps work anonymised.
