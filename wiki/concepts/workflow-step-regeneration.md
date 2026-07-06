---
title: Workflow step regeneration (resume-from-step-N)
category: concept
created: 2026-07-06
updated: 2026-07-06
related: [[workflow-run-history]]
---

Re-run a single step of a saved workflow run in place — optionally with feedback, on a different model, and cascading downstream — without re-billing or re-rolling the steps that were already good. Shipped across three PRs (#179 → #181), live in PROD 2026-07-06. No DB migration (reuses the `step_results` JSONB).

## Why

A workflow chains AI steps; quality problems happen per step. Before this, the only in-tool fix for one bad step was re-running the whole workflow (re-bills + re-rolls the good steps) or editing the output by hand. Regeneration makes the **step** the unit of iteration.

## The primitive

The core is `executeStep(step, context, rulesBlock, opts)` in `lib/workflows/executor.ts` (PR #179) — the single per-step body shared by original execution and regeneration. It never throws: a failed step returns a `StepResult` with `status: "error"` and an empty context patch, so a failure can never add context keys downstream. `opts` carries the regenerate extras: `modelOverride` (E3) and `feedbackAddendum`.

## Flow

```
saved run snapshot ─▶ rebuild prefix context ─▶ preflight (eligibility + drift)
                                                       │ ok            │ fail
                                                       ▼               ▼
                        executeStep(target..end) ─▶ amend in place    409 / 404
                        (overwrite ONLY on success,                   (before the
                         append for a failed-resume)                   SSE opens)
                                                       │
                                                       ▼
                                    amendRun (single write, rows-affected guard)
```

- **Server rebuilds context** from the run's own `inputs` + `step_results` (both key forms `step_<id>.<outputKey>` and `step_<id>.result`). The client never supplies execution context — a stale/hostile client can't inject state. `preflightRegenerate` + `rebuildContext` are pure and unit-tested.
- **Drift guard (409)** — before any LLM call, every step that will run must have its current input mappings resolvable against the rebuilt keys. Catches renamed output keys, changed mappings, and deleted/reordered steps; refuses in plain language ("this run predates your workflow edits — run it again").
- **Overwrite only on success** — a failed regenerate leaves the prior good output untouched (`amendRun` writes the amended array once at the end). A failed-resume appends steps that never existed in the snapshot.
- **Downstream stale** — regenerating a middle step without cascading marks the downstream outputs `isStale` (they were derived from the old output); the UI dims them and offers "Rerun from here". No warning colour — DESIGN.md allows only one accent, so staleness is opacity + a plain label.
- **Evict-race guard** — `amendRun`'s scoped `UPDATE` checks rows-affected; 0 means the run was pruned past the 22-cap mid-amend, surfaced as an error, not a phantom success (the LLM was already billed).
- **SSE-cancel** — a client disconnect persists the completed-so-far amend via a `finally`.
- **Concurrency** — an in-process guard rejects a second regenerate on a run already regenerating; last-write-wins across instances is accepted while single-user (revisit a durable lock at the org migration).

## Expansions

- **Make permanent (E1)** — after a clean regenerate with feedback, one click appends that feedback to the step's persisted prompt so future runs inherit it. `POST /api/workflows/[id]/steps/[stepId]/prompt` → `appendStepPrompt`: ownership verified, then an atomic single-step `UPDATE ... SET prompt = left(prompt || addition, 50000)` scoped to `(stepId, workflowId)` — deliberately NOT the workflow PUT that rewrites every step row.
- **Model override (E3)** — an optional per-regenerate model picker (admin-enabled models); the amended step records the model that produced it.

## Where it lives

- `lib/workflows/executor.ts` — `executeStep` (shared primitive, opts).
- `lib/workflows/regenerate.ts` — `preflightRegenerate` + `rebuildContext` (pure), `regenerateStream` (the streaming amend), in-process concurrency guard. The prior output embedded in the feedback prompt is fenced as quoted DATA with a per-call random marker (prompt-injection defence for the multi-user future).
- `lib/workflows/runs.ts` — `amendRun` (owner-scoped in-place write, evict-race rows-affected guard).
- `lib/workflows/types.ts` — `StepResult` provenance fields (`source: "regenerate"`, `regeneratedAt`, `feedback`, `replacedOutput`, `isStale`) — JSONB, no migration.
- `app/api/workflows/[id]/runs/[runId]/steps/[stepId]/regenerate/route.ts` — SSE route; preflight → HTTP codes (401/404/409/429) before the stream opens; per-user rate cap.
- `app/api/workflows/[id]/steps/[stepId]/prompt/route.ts` — E1 make-permanent.
- `components/workflows/run-tab.tsx` — `StepResultCard` Regenerate control (progressive-disclosure popover: feedback + model picker + rerun-downstream), non-destructive transient error notice (a failed regenerate never shows the red failed-step body), stale treatment, make-permanent affordance. Wired in both the live and replay views.

## Design decisions (the trail)

Feature was scoped via `/plan-ceo-review` (SELECTIVE EXPANSION, accepted E1/E3/E4, skipped a compare view), architected via `/plan-eng-review` (the outside voice reversed an early "unify the two executor loops into one generator" call in favour of the `executeStep` extraction — the eager `executeWorkflow` path is dead for the UI), and the UI via `/plan-design-review` (the load-bearing call: a failed regenerate must never reuse the red failed-step styling over a kept-good output). Shipped as three staged PRs, each smoke-tested live and independently reviewed.

## Deferred (out of v1)

- Undo of `replacedOutput` (the prior output is persisted; no undo UI).
- Prompt-edit version history for make-permanent.
- Multi-user regeneration locking (last-write-wins holds single-user) — both tied to the org migration.

## Verification

- Pure unit tests: `preflightRegenerate` (eligibility, drift on renamed keys, resume-the-failed-step), `rebuildContext`, `executeStep` opts.
- Real-DB (pglite): `amendRun` rows-affected + `(id, workflowId, userId)` scoping + no-clobber; `appendStepPrompt` append + non-owner refusal + missing-step `not_found`.
- Live: a real regenerate persisted with `source: "regenerate"`, prior output stashed, downstream marked stale, output changed; both new routes 401 in PROD (deployed).
