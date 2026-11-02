---
title: The pipeline appended a Related reading list the blog page already shows as Read next
category: synthesis
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]]
---

## Problem

The draft pipeline's assemble step added a "Related reading" section of up to three site posts to every draft body, picked by embedding similarity. Rob asked why: the blog page already renders a Read next block (`ReadNext` in `app/blog/[slug]/page.tsx`, fed by `getReadNext`, which uses the same embeddings). I had treated "internal links" from the SEO follow-up list as work to do, built it in the assembler, and never opened the page template to see what a post already shows. The result was two lists of related posts on one page, and the one in the body was static where Read next stays current as posts are published.

## Fix

Removed the section, its dependency in `wire.ts` and its tests. `assemble.ts` now adds only Sources and the schedule. A test asserts the body carries no "Related reading". The one DEV draft that had the block (GMO) was cleaned by hand; the other three had none because no site post was close enough to link.

## Rule

- **Before adding anything to generated content, read what the page template already renders around it.** A feature that the template or another job provides belongs there, not in the body.
- **A backlog or follow-up item names a goal, not a design.** "Internal links" was already met by Read next; check whether the goal is met before building toward it.
- **Review a generated draft on the page a reader sees (the Preview), not only as markdown.** The duplicate was obvious there and invisible in the code.
