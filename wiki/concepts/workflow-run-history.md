---
title: Workflow run history (capped retention + replay)
category: concept
created: 2026-06-30
updated: 2026-07-06
related: [[org-consulting-workspace]], [[workflow-step-regeneration]]
---

Every workflow execution is snapshotted to `workflow_execution_run`, the most recent 22 runs per workflow are kept, and past runs are browsable, replayable, and **per-step regenerable** from the Run tab. Replay is no longer read-only — see [[workflow-step-regeneration]] for how one step of a saved run is re-run in place.

## What it does

- **Persist** — each run (streaming or non-streaming) stores a full snapshot: `inputs`, `step_results` (the `StepResult[]` array with every step's output), `status`, `total_duration_ms`. This already existed; the snapshot is the source of truth for replay.
- **Cap at 22 per workflow** — after each run is inserted, older runs beyond the 22 most recent for that workflow are deleted. Cascade on `run_id` removes the matching `workflow_execution_log` rows too. Scope is **per workflow**, not per user.
- **Retrieve** — `GET /api/workflows/[id]/runs` lists run summaries (no heavy blob); `GET /api/workflows/[id]/runs/[runId]` returns the full snapshot including step outputs.
- **Replay UI** — the Run tab has a collapsible "Past runs" panel. Selecting a run loads its snapshot and renders each step via the same `StepResultCard` used for live runs, with a "Back to live" affordance.
- **Regenerate (2026-07-06)** — a saved run is no longer immutable: any step can be re-run in place with optional feedback and an optional one-off model, optionally cascading downstream, and the run's `step_results` is amended (`amendRun`). Full detail in [[workflow-step-regeneration]].

## UX (the obsession-virus pass)

The first cut was functional but generic. The shipped version is built so a user can recognise and reuse any past run instantly:

- **Specific headlines, not timestamps.** Each row leads with the run's first non-empty input (`runHeadline`), so "Data quality is a business problem…" is distinguishable from "AI culture is not built…" at a glance. A generic timestamp list fails the "specificity over generality" rule.
- **Alive time.** `relativeTime` shows "2m ago / 3h ago / 2d ago", falling back to the absolute date past 7 days. `runWhen` collapses the replay-header "relative · absolute" pair to one value once they'd duplicate.
- **Actionable history — the loop.** "Use inputs" (hover-revealed per row; primary button in the replay header) drops a past run's inputs straight back into the form via `restoreInputs`, including dropdown fields. Browse → reuse → tweak → Execute is one click. This is what turns history from a museum into the fastest path to the next run.
- **Output-first on open.** `openRun` collapses both the input form and the history list so the run's output is what you see immediately — the output is why you clicked. The collapsed "Past runs" bar stays one click away for switching runs.
- **Status is loud.** A coloured left rail + "Completed/Failed" label + "Latest" badge on the most recent run.
- **Single scroll, no scroll-in-scroll.** The Run tab flows in the page's natural scroll. It does NOT box itself into `height: calc(100vh - …)` with an inner `overflow-y-auto`, and `StepResultCard` outputs are not capped at `max-h-[500px] overflow-auto` — long outputs flow into the one page scroll. The only bounded scroll left is the "Past runs" picker list (`max-h-64`), which is a menu, not content, and auto-collapses when a run is opened. The account shell sets no height/overflow, so the document is the single scroll context.
- **Steps are a single-open accordion.** A run is a multi-step pipeline; rendering every step's (long) output expanded means scrolling past intermediates to reach the deliverable. `StepResultCard` is a controlled accordion: collapsed headers show skill name + a plain-text preview + model/duration/tokens; clicking one opens its output and collapses the rest. The **final step is open by default** (it's the deliverable); during a live run the latest completed step takes focus as it streams. Open-state is *derived*, not synced via an effect: `openStep` is `null` (= follow the last step), `-1` (= all collapsed), or an explicit index — `liveOpenStep`/`historyOpenStep` resolve it per context. This avoids `react-hooks/set-state-in-effect` (which CI enforces) and makes the default track the newest step for free.

## Where it lives

- `lib/workflows/runs.ts` — `persistRun` (insert + prune), `runsToEvict` (pure cap-decision, unit-tested), `listRuns`, `getRun`, `amendRun` (in-place regenerate write, evict-race + owner scoped), `MAX_RUNS_PER_WORKFLOW = 22`.
- `lib/workflows/executor.ts` — both `executeWorkflow` and `executeWorkflowStreaming` call `persistRun` and use its returned run id for the per-step `workflow_execution_log` inserts (previously the log `runId` was `undefined`, so telemetry never persisted — fixed as part of this change).
- `app/api/workflows/[id]/runs/route.ts` and `app/api/workflows/[id]/runs/[runId]/route.ts` — auth → verify workflow ownership via `getWorkflow` → list/get.
- `components/workflows/run-tab.tsx` — "Past runs" panel + historical replay view.

## Design notes

- **Cap logic is pure.** `runsToEvict(idsNewestFirst, max)` returns the tail beyond `max`; `pruneRuns` selects all ids newest-first then deletes the surplus by id. Keeping the decision pure means the 22-cap is unit-testable without a DB (`lib/workflows/runs.test.ts`).
- **List vs detail split.** The list query uses `jsonb_array_length(step_results)` for a step count instead of shipping the whole blob; full outputs load lazily only when a run is opened.
- **Ownership** is enforced at the route (workflow must belong to the caller) before any run query runs; the run-history service filters by `workflowId`.
- **No DB migration** — `workflow_execution_run` / `workflow_execution_log` already existed and were live; this change only added retrieval, the cap, and the UI.

## Verification

- `runsToEvict` unit tests (under/at/over cap, custom max, cap == 22).
- Prune + `jsonb_array_length` list SQL validated against DEV Postgres in a rolled-back transaction (25 runs → evicts oldest 3, keeps 22 newest-first).
- Both API routes return 401 unauthenticated; tsc + lint + full vitest + build green.
