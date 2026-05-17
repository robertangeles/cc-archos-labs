---
title: Booking prompts in the database — soft-fallback by design
category: concept
created: 2026-05-17
updated: 2026-05-17
related: [[book-a-call-architecture]], [[claude-eval-suites]], [[integration-config]]
---

The three Claude prompts that power Book-a-Call (intake follow-up, pre-call brief, blog matching) live in `site_setting` and are admin-editable at `/admin/prompts` without a redeploy. Unlike the diagnostic narrative prompt, missing/malformed config falls back to hardcoded starters — booking degrades, never breaks.

## The two prompt-config models

Both diagnostic and booking prompts live in `site_setting`. They have deliberately different failure modes:

| Surface | Config row | When row missing or malformed |
|---|---|---|
| Diagnostic narrative | `diagnostic_prompt` | **Hard fails** — report generation refuses. Loud error pointing at `/admin/prompts` so admin can't silently ship a placeholder report. |
| Booking prompts | `booking_prompts` (3 sub-prompts in one row) | **Soft fallback** to hardcoded starters in `lib/booking-prompts-shared.ts`. Booking continues at v1 quality. |

See [[2026-05-17-soft-fallback-for-booking-prompts]] for the full decision rationale.

## Why three prompts in one row

Schema choice: a single `site_setting` row keyed `booking_prompts` with JSONB shape `{ followup, brief, blogMatch }` — each sub-prompt has its own `systemPrompt` + `version` label. Saving the row is one atomic transaction; partial updates are impossible.

Why not three rows: the prompts are co-evolved (they all share the "30-min discovery call" framing) and admins typically tune them together. One row keeps the editing semantics honest — you can't accidentally save a tuned `brief` against a stale `followup`.

The UI surfaces the three as separate cards on `/admin/prompts` (Stripe-Dashboard style), drilling into one editor each. The save handler loads the full row, patches the field the admin edited, PUTs the full row back. So even though the UX is "edit one", the storage stays atomic.

## The runtime loader

`lib/booking-prompts.ts` exports `getBookingPrompts()`:

```ts
export const getBookingPrompts = cache(async (): Promise<BookingPrompts> => {
  let rows;
  try {
    rows = await db.select(...).from(siteSetting).where(eq(..., "booking_prompts")).limit(1);
  } catch (err) {
    console.warn("[booking-prompts] DB unreachable, falling back to hardcoded starter");
    return BOOKING_PROMPTS_STARTER;
  }
  if (rows.length === 0) return BOOKING_PROMPTS_STARTER;
  const parsed = BookingPromptsSchema.safeParse(rows[0].value);
  if (!parsed.success) {
    console.warn("[booking-prompts] Stored row failed validation, falling back");
    return BOOKING_PROMPTS_STARTER;
  }
  return parsed.data;
});
```

Three fallback paths. All log a warning. None throw. `cache()` from React dedupes within a request so a single `/api/booking/create` only hits the DB once even if multiple Claude call sites need the prompts.

`BOOKING_PROMPTS_STARTER` (in `lib/booking-prompts-shared.ts`) IS the runtime fallback — these are the prompts the system ran on before PR #45 moved them to DB. Editing in `/admin/prompts` improves over the floor; deleting the row drops back to the floor.

## Status surfacing in the admin UI

`/admin/prompts` shows a card per prompt with a status pill:

- **Configured** — admin has saved a version string that's NOT `"starter-v0"` (the sentinel for "haven't touched it")
- **Starter** — version is `"starter-v0"` (or row doesn't exist) — running on hardcoded fallback
- **Not configured** — only applies to the diagnostic prompt (which has no fallback)
- **Malformed** — DB row exists but fails Zod (shouldn't happen via the admin UI; only if someone hand-edits the JSONB)

Using the version label as the "has admin tuned this" signal is more reliable than diffing the full `systemPrompt` string — admins typically bump the version when they iterate, and whitespace drift on the prompt body shouldn't flip the badge.

## How edits flow to runtime

1. Admin edits a prompt at `/admin/prompts/[slug]`
2. Save → PUT `/api/admin/settings/booking-prompts` → upsert the row
3. Next request to a Claude call site triggers `getBookingPrompts()` (cache() doesn't survive across requests in production — each request is a fresh cache)
4. Loader fetches the updated row, returns the new value
5. Claude call uses the new prompt

No deploy. No restart. Edit at 10pm, next prospect booking at 10:01pm uses the new prompt.

## Why this differs from diagnostic

The diagnostic narrative prompt is **production-critical IP** — it's the practitioner voice that makes the AI Readiness Assessment defensible. There's no good "v1 fallback" because:
- The report is the deliverable to a paying-soon prospect; a generic LLM-default report would erode trust
- Source-of-truth being only in DB forces the operator to seed the prompt before they accidentally ship a report

Booking prompts are **operational AI augmentation** — they make the call go better but they're not the deliverable:
- The pre-call brief is a 60-second skim doc for Rob; a "raw intake" fallback is good enough
- The conversational intake is a UX nicety; a static form is a working v0
- Blog matching is a "while you wait" garnish; an empty reading list is fine

So the soft/hard split tracks "is this AI surface load-bearing for revenue, or is it convenience?" Diagnostic = revenue. Booking prompts = convenience.

## Eval discipline

Editing a prompt is one click. Editing it BADLY can ship in seconds. `pnpm eval` runs 15 fixture cases against the live API to catch regressions before save — see [[claude-eval-suites]]. The eval costs ~$0.02 per run and isn't in CI; it's an opt-in safety net the admin runs after each substantial edit.

## Where the code lives

- `lib/booking-prompts-shared.ts` — Zod schema + `BOOKING_PROMPTS_STARTER` (runtime fallback)
- `lib/booking-prompts.ts` — server-only loader with `cache()`
- `lib/claude-booking.ts` — three call sites (`generateConversationalFollowup`, `generatePreCallBrief`, `matchBlogPosts`) each `await getBookingPrompts()`
- `app/api/admin/settings/booking-prompts/route.ts` — GET / PUT
- `app/admin/(authed)/prompts/page.tsx` — cards grid (shared with diagnostic)
- `app/admin/(authed)/prompts/[slug]/page.tsx` — drill-down dispatcher
- `app/admin/(authed)/prompts/[slug]/booking-prompt-editor.tsx` — client form (loads full row, edits one sub-prompt, PUTs full row back)
