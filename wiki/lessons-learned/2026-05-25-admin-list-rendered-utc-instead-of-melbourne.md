---
title: "Lesson: a save path and a read path that don't share a timezone helper will drift"
category: lessons-learned
created: 2026-05-25
updated: 2026-05-25
related: [[log]]
---

## Problem

A blog post scheduled for "May 26 at 9 AM Melbourne" appeared in the admin list at `/admin/blog/posts` as `scheduled · 05-25 23:00Z`, and an already-published post stamped `2026-05-24T23:00:04.999Z` showed up labelled "Published 2026-05-24" — looking exactly one day early. The scheduler, the cron, and the DB stamps were all correct: `23:00 UTC = 09:00 next-day Melbourne` is precisely when the scheduled-publish picker had aimed at. The bug was purely in the **list's date renderer**.

Two formatters in [posts-list.tsx](../../app/admin/(authed)/blog/posts/posts-list.tsx) were sliced UTC ISO strings:

```ts
function formatDate(d: Date): string {
  const iso = new Date(d).toISOString();  // ← always UTC
  return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

function formatScheduleShort(d: Date): string {
  const iso = new Date(d).toISOString();
  return iso.slice(5, 10) + " " + iso.slice(11, 16) + "Z";  // ← even advertises UTC
}
```

Meanwhile the **save path** in [post-form.tsx](../../app/admin/(authed)/blog/posts/post-form.tsx) was correct end-to-end: it had its own `MELBOURNE_TZ`, `melbourneParts`, `splitMelbourneDatetime`, and `melbourneWallToUtcIso` helpers using `Intl.DateTimeFormat({ timeZone: "Australia/Melbourne" })`, with DST handling for AEDT/AEST transitions. The picker interpreted user input as Melbourne wall-time and wrote UTC. Correct.

The two surfaces had **separate, non-shared mental models** of how to format dates. The save path was tz-aware; the read path was naïve. Off-by-one only manifested between 14:00–23:59 UTC — exactly where 09:00 AEST schedules land. So the bug was real but easy to miss in dev environments where most testing happens during Melbourne working hours (i.e. UTC morning, where dates align by accident).

## Fix

Extracted both sides' helpers into [lib/format-melbourne.ts](../../lib/format-melbourne.ts) as one shared module. The picker now imports `splitMelbourneDatetime`, `melbourneWallToUtcIso`, `formatMelbourneForHumans`, `melbourneTzAbbrev`. The list imports new sibling formatters `formatMelbourneDateTime` (for the date column) and `formatMelbourneShort` (for the chip), built on the same `melbourneParts` primitive the picker uses. The list's chip now appends a live `AEST`/`AEDT` label so the column is unambiguously local, not UTC.

Shipped with 14 vitest unit tests anchoring on the production bug: AEST + AEDT, midnight-rollover normalization, round-trip wall ↔ UTC. The tests fail loudly against the old `.toISOString().slice(...)` path.

Landed in [PR #109](https://github.com/robertangeles/cc-archos-labs/pull/109).

## Rule

**When a value is converted at the wire boundary (e.g. wall-time → UTC on save), the inverse conversion (UTC → wall-time on read) must use the same module.** Inline `.toISOString().slice(...)` anywhere a user-facing wall-time is rendered is a smell — it's *always* UTC, and any save path that was tz-aware will silently diverge.

Operationally:

- One shared `lib/format-<timezone>.ts` module per anchored timezone the product uses. Pickers and renderers import from it; never reformat dates inline.
- If you see two functions named `formatDate` in different files with the same body, they're either both correct (refactor candidate) or both wrong (latent bug). Either way they don't belong duplicated.
- Off-by-one date bugs that only fire in a slice of UTC hours are the classic signature of timezone drift. Test fixtures should specifically anchor on UTC instants whose wall-time falls on the **other side of midnight** in the rendering timezone.
