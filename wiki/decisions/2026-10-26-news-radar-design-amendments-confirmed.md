---
title: News radar design amendments confirmed by the build review
category: decision
created: 2026-10-26
updated: 2026-10-26
related: [[news-radar]], [[news-radar-runbook]]
---

## Decision

The design review (2026-10-25) amended the engineering decisions for the Radar page and asked that the engineering side confirm them before the page was built. Confirmed while building PR2, with the reasons:

| Amendment | Confirmed | Why it holds |
|---|---|---|
| DES-D6: a third label value `clear` (pressing the selected button un-labels) | yes | One allowed value in a CHECK constraint, already in migration 0042, so no second migration. The gate counts a latest `clear` as unlabelled. |
| DES-D7: "Use mine" after a 409 | yes | It is just a new PATCH carrying the conflict's `latestLabelId`, so it needs no new endpoint. |
| DES-D3/D4: the To label queue is newest first, uncapped | yes | Display order only; eligibility and the gate population are untouched. Inspection views keep the ENG-D11 order (audience fit descending). |

## Two things the build changed

- **`latestLabelId`.** ENG-D12 had the stale check compare against "the latest label". With `clear` that is ambiguous: after a clear the page sees no label, so it could never send a correct `ifLatestLabelId`. The API and the page now carry the id of the NEWEST label row, a `clear` row included, and the stale check compares against that. A 409 whose current state already equals the requested change is treated by the page as success, with no note.
- **Same-origin guard on the label route.** `lib/auth/csrf.ts` says every mutating `/api/admin/*` route should call `assertSameOriginRequest`, but none of the existing admin mutation routes do. The new route does (a label is the evaluation's ground truth), on top of `SameSite=Lax`. The other admin routes are not changed here; backlog already tracks the missing guard on a brain DELETE.

## What stayed as designed

Labels are append-only and restricted from deletion; there are no keyboard shortcuts in Release 1 (DES-D13); first labels are only set in To label (DES-D14); Show scores is off by default (DES-D9).
