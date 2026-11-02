---
title: Skills, Workflows and Social posts removed from the Metis workspace
category: decision
created: 2026-11-02
updated: 2026-11-03
related: [[news-draft-pipeline]], [[scheduled-social-posts]], [[workflow-run-history]], [[workflow-step-regeneration]], [[deployment-architecture]], [[integration-config]], [[2026-11-02-check-what-a-live-pipeline-reads-before-deleting-a-feature]]
---

Rob: "In the Metis Workspace I want you to remove Skills, Workflows, Social posts. We will never use them again so I want a proper cleanup."

## What went

| Feature | Removed |
|---|---|
| Skills | `/account/skills/*` pages, `/api/skills/*`, `components/skills/`, `lib/skills/`, the chat `/run` command (`/api/chat/slash-command`, `lib/chat/slash-commands.ts`, `ChatSkillForm`), the nav entries |
| Workflows | `/account/workflows/*`, `/api/workflows/*`, `components/workflows/`, `lib/workflows/` (executor, runs, regenerate, service), the nav entries |
| Social posts | `/account/scheduled-posts`, `/account/social-accounts` (and its Profile tab), `/api/social/*`, `/api/cron/process-scheduled-social`, `components/social/`, `lib/social/`, the chat "Publish" button and `PublishModal`, the admin Integrations "Social Accounts" section and its seven config fields (`twitter*`, `linkedin*`, `blueskyEnabled`) |
| Tables (migration 0044) | `skill_input`, `skill_output`, `skill_version`, `skill_execution`, `workflow`, `workflow_field`, `workflow_step`, `workflow_execution_run`, `workflow_execution_log`, `workflow_pending_approval`, `workflow_exec_token`, `social_account`, `publish_log`, `scheduled_social_post` |

## What stayed, and why

- **The `skill` table, and `lib/news-radar/draft/skills.ts`.** The news draft pipeline loads all four of its prompts from `skill` by slug (`archos-news-research-brief`, `archos-slop-judge`, `archos-editorial-photo`, `archos-ai-news-factcheck`). The Skills pages were the only editor for those rows, so **a prompt change is now a row edit in the database**. `scripts/seed-news-draft-skills.mts` still creates missing rows and never overwrites one; it now inserts straight into `skill` (the inputs/outputs it used to carry were builder metadata nothing read).
- **The blog share links and `lib/social-links`** (profile links, `sameAs`). Different feature.
- The generic `site_setting` integration blob. Its stored copy still carries the seven social keys on PROD and DEV; the schema ignores them and the next master-key rotation drops them (test: `integration-config.test.ts`).

## What moved (it was shared, not Skills-only)

| Was | Now | Used by |
|---|---|---|
| `lib/workflows/fence.ts` | `lib/news-radar/draft/fence.ts` (+ `fence.test.ts`) | the draft pipeline's prompt-injection fencing |
| `OPENROUTER_MODELS` in `lib/skills/types.ts` | `lib/llm-models.ts` | admin Integrations panel, the models route |
| `GET /api/skills/models` | `GET /api/models` | the chat model picker, two brain e2e specs |
| `components/skills/use-enabled-models.ts` | `components/chat/use-enabled-models.ts` | chat workspace and picker |

## Verified

`pnpm tsc` clean; `vitest` 2666 passed (185 files, 4 workers — full parallelism was OOM-killed with swap full); `pnpm lint` 0 errors; `pnpm build` ok; a new Playwright spec (`tests/e2e/workspace-removed-features.spec.ts`) proves the nav, pages and APIs are gone and `/api/models` is 200 signed in and 401 anonymous; `brain-isolation`, `brain-no-fabrication` and `chat-attach-files` still pass. On DEV: migration 0044 applied (14 tables gone, `skill` kept with its 10 rows, the draft tables untouched), the real stored integration blob with all seven stale keys loads, the four pipeline skills load and build with nothing unfilled, and the rewritten seed insert ran inside a rolled-back transaction.

## PROD: applied 2026-11-02

Merging ships code and never schema, so PROD ran the new code on the old tables until the migration was applied by hand, after the deploy.

1. Done. Merged and deployed (the previous release still read these tables).
2. Done. `pg_dump` of PROD to `~/archos_prod_backup_20261102_pre0044.dump` (44.6 MB, `pg_restore --list` reads it), `__drizzle_applied` checked (PROD was at 0043, only 0044 and 0045 pending), then `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` applied 0044 and [[2026-11-02-remove-model-studio]]'s 0045 in one pass. All 14 tables are gone; `skill` was kept (10 rows, the four news prompts present) and the draft and radar tables are untouched. **Rows lost, counted just before the run:** `skill_input` 35, `skill_output` 10, `skill_version` 17, `workflow` 1 (with 5 fields, 5 steps, 22 runs, 99 log rows), `social_account` 3 (encrypted tokens), `publish_log` 17, `scheduled_social_post` 7; `skill_execution`, `workflow_pending_approval` and `workflow_exec_token` were empty. The dump is the only copy.
3. Done 2026-11-03. Rob deleted the Render cron `process-scheduled-social` (`crn-d8n925urnols73df41v0`) in the dashboard; it had POSTed the removed route every minute and got a 404. Checked afterwards with `render services`: five crons remain and `process-scheduled-posts` still answers 401. The Render CLI and MCP can list services but not delete them, so this was a dashboard click. An earlier version of this page called it `social-publisher`; that is the id of its `cron_heartbeat` row (still on PROD, last written 2026-07-10, nothing reads it), not the cron's name. **Do not delete its neighbour `process-scheduled-posts`** (`crn-d86ltiegvqtc73drc2og`): that is the blog scheduler, and its route is alive (401 without the secret). The Render CLI and MCP can list services but not delete them, so this is a dashboard click.
4. Optional hygiene, not done: strip the seven stale social keys from PROD's `integration_secrets` blob (two of them are encrypted client secrets).

## Not done

- `skill.current_version`, `last_used_at`, `use_count` are builder bookkeeping nothing writes now. Left alone: altering the table the live pipeline reads is more risk than the columns cost.
- `CLAUDE.md` still names `pnpm test:integration`, which does not exist in `package.json`.
