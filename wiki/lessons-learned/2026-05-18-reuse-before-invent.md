---
title: When a working reference exists in the codebase, reuse it before inventing
category: lessons-learned
created: 2026-05-18
updated: 2026-05-18
related: [[2026-05-18-pages-cms-expansion]]
---

## Problem

Building /consulting on the Phase 2 Pages CMS, three visual iterations were thrown out before landing on the right approach:

1. **First pass** — generic 5-block layout (Hero / Markdown essay / ServiceGrid / Markdown process / CtaPair). Read as a thinner subset of the home page.
2. **Second pass** — invented new "editorial" block types (`editorial_essay`, `process_steps`, `editorial_faq`, `closing_statement`) with bespoke typography moves: numbered section counters, mono `Q —` / `A —` labels, hairline architecture between sections. Read as well-mannered editorial newspaper. Not "selling work."
3. **Third pass** — full-bleed dramatic typography: viewport-filling pull-quotes, 200px mono numerals on process steps, display-xl statement openings. Visually loud but felt like guessing at "exec design."
4. **Final pass** — discarded all custom editorial blocks. Used the home page's existing section components as block adapters: `Hero`, `Section`, `Timeline`, `ServiceCard`, `ObjectionFaq`, `ProofItem`. Cleared the bar in one iteration.

The right move was visible in the codebase the entire time: the home page (shipped, approved, "we built that flawlessly") was the design standard. /consulting needed to reuse its components and extend its vocabulary, not parallel it with new patterns.

Three rounds of wasted iteration before this clicked. Rob had to say "look at the home page, we built that flawlessly" before the obvious answer registered.

## Fix

Before inventing new component patterns for a new page, scan the existing codebase for analogous solved problems. If a sibling page in the same project has the visual treatment the new page needs, reuse the source components — don't build a parallel implementation.

For the Pages CMS specifically: the block_type registry is the EXTENSION mechanism, but each new block_type should wrap an EXISTING approved section component first. New visual treatments are an extraction from the existing design system, not an addition to it.

## Rule

**When a working reference exists in the same codebase, reuse it before inventing.**

- For visual design: scan `components/sections/*` for analogous patterns BEFORE writing new ones. If the home page solves a layout, the consulting page should use those same primitives.
- For data patterns: scan `lib/*` for analogous services BEFORE writing new ones (e.g. retention purge libs adopted the existing scheduled_job pattern rather than inventing a new queue).
- For type patterns: scan `lib/db/schema.ts` for analogous shape BEFORE designing a new table (immutable audit tables all mirror `integration_secret_audit`'s actor + timestamp shape).

When the user says "look at X, we built that flawlessly," the answer is almost always "use X's components directly, don't reinvent." Spend ten minutes reading the reference before writing a single line of new code.

The cost of inventing in a vacuum compounds: each iteration produces work that has to be torn down. Reading the reference first costs minutes and saves hours.

Related: [[2026-05-18-pages-cms-expansion]] (the Pages CMS Phase 2 plan that introduced the block_type registry — the registry's job is to make REUSE cheap, not to encourage invention).
