---
title: Skills, Workflows and Social posts removed from the Metis workspace
category: decision
created: 2026-11-02
updated: 2026-11-02
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

## PROD: what is still to do

Merging ships code and never schema, so after the merge PROD runs the new code on the old tables, which is harmless. In this order:

1. Merge and let Render deploy (the previous release still reads these tables).
2. `pg_dump` PROD, check `__drizzle_applied`, then `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` for 0044. **Destructive**: PROD skills' version history, all workflows and run history, connected social accounts (encrypted tokens), scheduled and published social posts.
3. Delete the Render cron job `social-publisher`. Until then it POSTs the removed route every minute and gets a 404.
4. Optional hygiene: strip the seven stale social keys from PROD's `integration_secrets` blob (two of them are encrypted client secrets).

## Not done

- `skill.current_version`, `last_used_at`, `use_count` are builder bookkeeping nothing writes now. Left alone: altering the table the live pipeline reads is more risk than the columns cost.
- `CLAUDE.md` still names `pnpm test:integration`, which does not exist in `package.json`.
