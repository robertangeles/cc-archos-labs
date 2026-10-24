---
title: Remove the blog agent pipeline entirely
category: decision
created: 2026-10-24
updated: 2026-10-24
related: [[blog-writer-agent]], [[blog-writer-agent-runbook]], [[2026-10-24-remove-ai-slop-posts]], [[2026-10-24-gate-measured-grounding-not-value]]
---

The unattended blog writer was switched off, 206 of its 254 posts were removed ([[2026-10-24-remove-ai-slop-posts]]), and the owner then decided to remove the whole pipeline and build a new one from a fresh design, not patch this one. Last commit that contains it: `5b2b261`.

## Removed

- `lib/blog-agent/` (orchestrator, queue, planner, judge, slop gate, duplicate guard, image, internal links, alerting, config, admin view-model, tests, fixtures).
- `POST /api/cron/write-blog-post`, `POST /api/admin/blog-agent/retry`, `/api/admin/settings/blog-agent` and `/blog-agent-prompt/[kind]`.
- Admin: `/admin/blog/pipeline`, the "Blog agent" sub-nav tab, and the three cards and editors on `/admin/prompts` (agent config, reviewer rubric, topic planner).
- Scripts: `seed-blog-agent-config`, `seed-illustration-skill`, `uat-blog-agent`, `backfill-orphan-post-image`, `generate-blog-fallback-image`; the fence eval test and the pglite queue helper.
- `attachFallbackImageToPost` in `lib/posts-admin/attach-image.ts` (only the agent called it).

## Kept on purpose

| Kept | Why |
|---|---|
| `content_plan_item` table + its definition in `schema.ts` | 281 rows with judge verdicts are the best record of what the gate missed. The definition stays because deleting it from `schema.ts` alone makes the next `drizzle-kit generate` emit a `DROP TABLE`. Drop both together in a migration (it needs the `-- safety:` header). |
| The "Archos Labs Blog" workflow and its `archos-*` skills | Workflow-builder content that existed before the agent and is used by the Regenerate feature. A new pipeline may reuse it. |
| `post.is_agent_generated` and the publisher guard `NOT (is_agent_generated AND needs_review)` | Marks which posts were machine-written; the guard still protects any flagged post. |
| `public/images/blog-fallback.webp` | Posts that took the house illustration still point at it. |

## Operational follow-ups (not in the diff)

1. Delete the Render cron service `blog-writer-agent`. Without the route it would fail every run (`curl -f` on a 404) and send failure alerts. The Render MCP exposes no delete and there is no API key in the environment, so this is a dashboard action.
2. Remove the `BLOG_CRON_SECRET` env var from the web service (nothing reads it any more).
3. Tidy the DB: `site_setting` rows `blog_agent_config` (and `blog_judge_prompt` / `blog_plan_prompt` if present), and the `cron_heartbeat` row `blog-writer`.

## Rebuilding

The design constraints from the review are in [[2026-10-24-gate-measured-grounding-not-value]]. Recover any removed code with `git show 5b2b261:lib/blog-agent/<file>`.
