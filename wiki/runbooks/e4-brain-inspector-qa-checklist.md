---
title: QA — Brain workspace inspector (E4)
category: runbook
created: 2026-07-24
updated: 2026-07-24
related: [[project-workspace-memory-plan]], [[conversational-memory-design]], [[brain-pgvector-uat-checklist]]
---

Hand-run this before shipping the E4 Brain inspector — the `/account/brain` page that adds the org-shared **Workspace** memory tier next to the private **Chat** tier. ~10 min for A–D.

- **Branch:** `feature/brain-workspace-inspector` · **Commit:** `4da44c0`
- **Surface:** http://localhost:3007/account/brain (`pnpm dev`)
- **Design source:** design-shotgun E4-A (segmented `All / Chat / Workspace` + entity-grouped rows). See [[project-workspace-memory-plan]].

**Legend:** ✅ testable now (workspace tier is empty on DEV — `WORKSPACE_MEMORY_INGEST` has never been on) · 🔒 needs workspace rows, so browser-blocked → covered by the 16 automated tests in `app/api/brain/memories/route.test.ts` instead.

---

## A. Visual / layout
- [ ] 1. ✅ Header count = chat + workspace total (not chat only)
- [ ] 2. ✅ Three segments render: `All` · `Chat` · `Workspace`, each with a count badge
- [ ] 3. ✅ Active segment has the lavender underline; inactive are muted grey
- [ ] 4. ✅ Count badges legible, not noisy — keep or cut?
- [ ] 5. ✅ Chat memory row density unchanged from before

## B. Segment behavior
- [ ] 6. ✅ Click each segment → active state + underline follow
- [ ] 7. ✅ `Workspace` shows empty state: "Metis hasn't learned anything from your workspace yet."
- [ ] 8. ✅ `Chat` shows existing chat memories, unchanged
- [ ] 9. ✅ `All` shows chat memories (workspace empty)
- [ ] 10. ✅ Switching segment resets pagination to page 1

## C. Search
- [ ] 11. ✅ Search on `Chat` filters chat rows
- [ ] 12. ✅ Search on `Workspace` (empty) → "No workspace memories match that search."
- [ ] 13. ✅ Clear search → full list returns

## D. Regression — private tier must still work
- [ ] 14. ✅ Expand a chat memory (chevron) → full content shows
- [ ] 15. ✅ Delete a chat memory (hover trash) → row disappears, count drops
- [ ] 16. ✅ Pagination Prev/Next works when >10 chat memories

## E. Workspace tier — 🔒 blocked without rows (verified by unit tests)
- [ ] 17. 🔒 Rows group under `Projects` / `Clients` / `Cards` headers
- [ ] 18. 🔒 Each row: entity name, fact preview (muted), timestamp
- [ ] 19. 🔒 Owner/admin sees delete affordance; plain member does not
- [ ] 20. 🔒 Delete a workspace row → soft-deletes, row vanishes

## F. Security — 🔒 verified by the 16 route tests, not browser
- [ ] 21. 🔒 GET scopes workspace to server-resolved org (not the cookie)
- [ ] 22. 🔒 DELETE `?scope=workspace` — owner/admin only (403 for member)
- [ ] 23. 🔒 Out-of-org id → 404, no existence oracle
- [ ] 24. 🔒 No-org user → private tier still renders (fail-soft)

---

## To exercise E + F with real data (optional, later)

No fake rows. To see the populated tier for real: on one DEV org, set `WORKSPACE_MEMORY_INGEST=true`, create a real project + client + card, then walk items 17–20. Backfill an existing org with `pnpm backfill:workspace-memory --org <id>`.

---

## Notes / findings
_(record anything that looks off as you walk A–D)_

-

---

## Sign-off
- [ ] A–D walked in the browser, no blockers
- [ ] E–F accepted on automated coverage (or scheduled for a real-data pass)
- [ ] Decision: **ship** / **fix first**
