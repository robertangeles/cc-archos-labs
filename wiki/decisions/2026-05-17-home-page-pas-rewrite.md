---
title: Home page PAS rewrite — May 2026
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[2026-05-07-home-page]], [[design-system]], [[book-a-call-architecture]], [[state]], [[shipped]]
---

May 2026 rewrite of the home page from a 4-section practitioner pitch (Hero → What we do → Who we work with → Closing CTA, single Book a call CTA) to a 9-section PAS sales page (Hero → Agitate → Solution+Proof → Timeline → Services → Objection FAQ → Who We Work With → Assessment Block → Final CTA, dual CTA throughout). Supersedes [[2026-05-07-home-page]].

## Why

The May 7 home page positioned but did not convert. It described what Archos Labs does without naming the cost of not engaging. The PAS draft (`CTA Copy.pdf`, May 2026) names the problem (data layer failures), agitates the personal accountability ("That decision has a name on it"), then offers proof + qualification. The assessment shipped on 2026-05-13, so the dual-CTA model (Take the assessment + Book a call) is now viable; the page also adds the assessment as the qualifier ahead of the booked call.

## Strategic decisions (locked in plan-mode review)

| # | Decision | Resolution |
|---|----------|------------|
| Q1 | Industries positioning | Include retail. Hero subhead + Built for list name four: financial services, healthcare, government, retail. Add a fourth proof point when a retail or government engagement is referenceable. |
| Q3 | Proof points | Ship the three from the PDF as written, with one copy correction: the sovereign-AI line reads "We're not the first, but one of the very few in Australia who have shipped this" (not "among the first"). |
| Q4 | Implementation approach | Componentise. Extract `Hero`, `Section`, `CtaPair`, `ProofItem`, `ServiceCard`, `AudienceList`, `Timeline`, `ObjectionFaq`, `AnchorNav`, `StickyMobileCta` into `components/sections/home/`. Pattern reusable for Consulting page + Tools index. |
| Q5 | Review mode | EXPANSION. 12 expansion candidates surfaced individually; 10 accepted, 2 skipped. |
| Q6 | Hero copy | PDF version: "Most AI programs fail at the data layer. By the time anyone admits it, the budget is gone." Lavender accent on "fail" carried forward from the May 7 hero. |
| Q7 | Agitate "That decision has a name on it" | Ship as written. Confrontational on purpose — names the exec reading the page. |

## Accepted expansions (E1–E9, E12; E4 + E10 + E11 dropped)

- **E1** Sticky mobile CTA bar (`components/sections/home/sticky-mobile-cta.tsx`). IntersectionObserver hides it on `#final-cta`. Honours `prefers-reduced-motion` and iPhone notch via `env(safe-area-inset-bottom)`.
- **E2** Analytics stub. `lib/analytics.ts` exports `track()`; dev logs to console, prod POSTs to `app/api/events/route.ts` (noop). Fires `page.viewed`, `cta.assessment.clicked`, `cta.bookcall.clicked`, `scroll.depth { pct }`, `anchor.nav.clicked { target }`. Wiring to a real analytics backend is a Phase-3 follow-up.
- **E3** Page-specific Schema.org JSON-LD. `lib/schema-org.ts` exports `buildHomePageServicesLd()` returning three Service entities. The root Organization + WebSite schemas already render globally in `app/layout.tsx`.
- **E4 DROPPED** — anonymised trust strip skipped for V1 per Rob.
- **E5** Counter-positioning one-liner in Solution+Proof: "We don't take retainers. We don't pad timelines. We don't bring 12-person teams to your meetings."
- **E6** Pre-CTA microcopy on every CtaPair instance: "8 min · no login required" + "30 min · we'll tell you if it's not a fit".
- **E7** 90-day timeline visualisation between Solution+Proof and Services (Week 0 → 1 → 2 → 4 → 12).
- **E8** Print-mode personalisation header. `lib/sanitise-name.ts` validates the `?name=` URL param via a strict allow-list regex (`/^[A-Za-z][A-Za-z\s\-']{0,49}$/`). Renders "Prepared for {name} · Prepared on {date}" on screen + print. Failed validation silently drops the name; React's default escaping handles the rendered text (never `dangerouslySetInnerHTML`).
- **E9** Inline objection-handler micro-FAQ using native `<details>`/`<summary>` — keyboard-accessible by default, no JS required.
- **E10 DROPPED** — visual sovereign-AI demo skipped; corrected text claim ("one of the very few in Australia") carries V1.
- **E11 DROPPED** — Modelling Room newsletter embed skipped; footer/nav link is enough for V1.
- **E12** Desktop anchor nav under hero ("Jump to · Services · Proof · Assessment"). Hidden below 1024px (`hidden lg:block`).

## Architecture

```
app/page.tsx (Server Component)
  ├── reads ?name= URL param, sanitises via lib/sanitise-name.ts
  ├── reads site settings → buildHomePageServicesLd(siteName)
  ├── renders Schema.org JSON-LD <script type="application/ld+json">
  ├── <AnalyticsClient route="/" /> (page.viewed + scroll.depth)
  ├── <main>
  │   ├── optional <div class="print-only"> personalisation header
  │   ├── <Hero> (with desktop AnchorNav slot)
  │   ├── <Section> Agitate
  │   ├── <Section id="proof"> Solution+Proof (with ProofItem ×3)
  │   ├── <Section> Timeline (Timeline component)
  │   ├── <Section id="services"> Services (ServiceCard ×3)
  │   ├── <Section> Objection FAQ (ObjectionFaq component)
  │   ├── <Section> Who We Work With (AudienceList ×2)
  │   ├── <Section id="assessment" bg="elevated"> Assessment Block (single CtaPair)
  │   └── <Section id="final-cta" bg="bordered" pad="relaxed"> Final CTA (CtaPair both)
  └── <StickyMobileCta hideWhenSelector="#final-cta" />

Side modules:
  lib/cta-urls.ts       BOOK_A_CALL_URL + TAKE_ASSESSMENT_URL (rename of lib/booking-urls.ts)
  lib/analytics.ts      track() — dev console.log, prod POST /api/events
  lib/schema-org.ts     buildHomePageServicesLd(orgName)
  lib/sanitise-name.ts  strict allow-list regex for ?name= URL param
  app/api/events/route.ts   noop POST endpoint returning { ok: true }
```

## Verification

- `pnpm tsc` clean
- `pnpm test` 19 files / 237 tests pass (16 new in `lib/sanitise-name.test.ts`, 4 new in `lib/analytics.test.ts`)
- `pnpm lint` clean (one pre-existing warning in `tmp/walkthrough.mjs`, unrelated)
- `pnpm build` clean — all routes present including the new `/api/events`
- Playwright at 375 / 768 / 1280 via [scripts/screenshot.mjs](../../scripts/screenshot.mjs) — visual + computed-style:
  - Mobile (375): hero stacks, CTAs stack, sticky mobile CTA bar renders at the bottom
  - Tablet (768): hero h1 hits 80px (`text-display-xl`), anchor nav hidden
  - Desktop (1280): anchor nav renders under the hero, all 9 sections render in order
- `?name=Jane%20Smith` renders "Prepared for Jane Smith · Prepared on 17 May 2026"
- `?name=<script>alert(1)</script>` → sanitiser rejects, "Prepared for" block does not render (verified by curl + grep — `alert(1)` strings in the response are React's escaped RSC payload, not executable HTML)

## What stays open

- E4 trust strip (deferred to TODOS — only revisit when a fourth proof point lands)
- PostHog (or replacement) wiring — `/api/events` is currently a noop sink, ready to forward
- Live sovereign-AI demo (P3 TODOS)
- Modelling Room newsletter embed (P3 TODOS)
- Signed-token print personalisation (P3 TODOS — if abuse appears)
- `/consulting` page rewrite (Phase 1 backlog — will reuse `Hero`, `Section`, `CtaPair`, `ServiceCard`, `AudienceList`)
