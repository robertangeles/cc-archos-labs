---
title: Model Studio removed from the Metis workspace
category: decision
created: 2026-11-02
updated: 2026-11-02
related: [[model-studio-canvas]], [[2026-11-02-remove-skills-workflows-social]], [[deployment-architecture]], [[2026-06-17-react-flow-height-collapse]], [[2026-06-16-migration-generated-not-applied]]
---

Rob, straight after the Skills/Workflows/Social removal: "/workspace/model-studio this too need to be removed".

## What went

- Pages: `/workspace/model-studio` and `/workspace/model-studio/[id]`; the "Model Studio" nav entry.
- API: everything under `/api/model-studio` (models, entities, attributes, relationships, canvas state, the feature-flag route).
- Code: `components/model-studio/`, `lib/model-studio/`, six hooks (`use-models`, `use-entities`, `use-attributes`, `use-relationships`, `use-canvas-state`, `use-model-studio-flag`), `tests/model-studio/`, the `app/api/model-studio` route tests, `tests/e2e/model-canvas.spec.ts`.
- Dependency: `@xyflow/react` (nothing else imported it).
- Tables (migration 0045): `data_model_attribute`, `data_model_relationship`, `data_model_canvas_state`, `data_model_entity`, `data_model`. The same migration deletes the `site_setting` row `model_studio`, the feature flag the page read (default off when absent).

## Checked before deleting

The lesson from [[2026-11-02-check-what-a-live-pipeline-reads-before-deleting-a-feature]] applied, so the readers were listed first: nothing outside the feature imported its hooks, services or tables; no shared helper lived in its folders; the only foreign keys pointing at the five tables are between the five tables (`pg_constraint` on DEV); `data_model` itself points at `project` and `users`, which stay. DEV held zero rows in all five and had no flag row (the feature was off).

## What stayed

- Migration files `0027_model_studio_data_model.sql` and `0028_unknown_puma.sql` stay in `drizzle/`: applied migrations are history, and `scripts/db-apply.mjs` replays the folder in order.
- `tests/helpers/org-test-db.ts` no longer applies 0027/0028, since the org tests never touched `data_model`.
- The wiki history: [[model-studio-canvas]] and the two lessons about the canvas stay as records.

## Verified

`pnpm tsc` clean; `vitest` 2521 passed in 171 files (145 fewer than before, all from the deleted Model Studio tests); `pnpm lint` 0 errors; `pnpm build` ok; `workspace-removed-features.spec.ts` now also asserts the Model Studio nav link is gone and its pages and APIs are 404. On DEV, a dump of the five (empty) tables was taken, then migration 0045 applied: 0 `data_model*` tables and no `model_studio` row left.

## PROD: applied 2026-11-02

Applied by hand after the deploy, in the same `db-apply.mjs` pass as 0044 ([[2026-11-02-remove-skills-workflows-social]] has the backup path and the full row counts). `__drizzle_applied` was at 0043 beforehand. Rows counted just before the run: all five `data_model*` tables held 0 and there was no `model_studio` `site_setting` row, so nothing was lost. Afterwards no `data_model*` table exists on PROD and `/workspace/model-studio` is 404.
