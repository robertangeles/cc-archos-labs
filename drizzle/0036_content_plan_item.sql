-- Migration 0036: content_plan_item + post.is_agent_generated — blog writer agent
--
-- Hand-written, matching the convention since 0031: the drizzle-kit journal
-- stops at 0030 and `db:generate` now prompts on every out-of-sync table, so
-- migrations here are authored directly and applied via scripts/db-apply.mjs
-- against __drizzle_applied.
--
-- Purely additive: one new table, one new column with a default, four indexes.
-- No DROP, so no `-- safety:` header is required by the CI migration-safety
-- check. Idempotent throughout (IF NOT EXISTS) so a partial apply can be
-- re-run, exactly as db-apply.mjs expects.
--
-- content_plan_item is the work queue the daily blog agent pulls from.
-- OLTP, 2NF: every non-key column depends only on the primary key (id).
--
--   plan.ts inserts a batch
--          |
--          v
--     +- pending <------------ sweeper (locked_until elapsed, attempts + 1)
--     |      | claim: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE, ONE txn
--     |      v                 (copied from lib/scheduler.ts:160 — NOT from
--     |   running               scheduled-publisher, whose transaction commits
--     |      |                  and releases the lock before the work starts)
--     |      +--> drafted  (terminal — post created, awaiting human review)
--     |      +--> skipped  (terminal — duplicate topic)
--     |      +--> failed   (terminal at attempts >= 3)
--     +------+
--
-- Two deliberate omissions, both load-bearing:
--
--   1. No `published` status. The scheduled publisher owns post.status; live
--      state is derived by joining post. One writer per column.
--
--   2. No FK to workflow_execution_run. That table is pruned to the newest 22
--      rows per workflow by pruneRuns (lib/workflows/runs.ts), and the DELETE
--      runs inside a swallowed catch{} in executor.ts. A reference from here
--      would make the prune throw an FK violation, get swallowed, and stop
--      retention forever — silently, while step_results grew unbounded.
--      Audit lives on judge_verdict + post + post_revision instead.

-- post.is_agent_generated scopes the publish gate to agent output.
--
-- scheduled-publisher withholds a due post only when this AND needs_review are
-- BOTH true. needs_review on its own is a GENERAL editorial flag — the WP
-- migration set it on 120 posts and any admin can set it on any post — so
-- gating on it alone would have silently stopped human-authored scheduled
-- posts from publishing. Doubles as the "agent-written" marker in the admin
-- list.
--
-- No index: only ever read alongside status = 'scheduled', which the existing
-- partial index post_due_for_publish_idx already serves (verified by EXPLAIN —
-- the extra predicate is a post-scan filter, not a new scan).
ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "is_agent_generated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_plan_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"shape" text,
	"category_id" uuid,
	"topic" text NOT NULL,
	"audience" text NOT NULL,
	"action" text NOT NULL,
	"field_note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"post_id" uuid,
	"judge_verdict" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_plan_item_category_id_category_id_fk') THEN
  ALTER TABLE "content_plan_item" ADD CONSTRAINT "content_plan_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_plan_item_post_id_post_id_fk') THEN
  ALTER TABLE "content_plan_item" ADD CONSTRAINT "content_plan_item_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
-- The dequeue, run on every cron tick: next pending item in batch order.
-- WHERE status = 'pending' ORDER BY day_number ... FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS "content_plan_item_status_day_number_idx" ON "content_plan_item" USING btree ("status", "day_number");
--> statement-breakpoint
-- FK index (mandatory per CLAUDE.md): "items in this category".
CREATE INDEX IF NOT EXISTS "content_plan_item_category_id_idx" ON "content_plan_item" USING btree ("category_id");
--> statement-breakpoint
-- FK index (mandatory per CLAUDE.md): "which plan item produced this post".
CREATE INDEX IF NOT EXISTS "content_plan_item_post_id_idx" ON "content_plan_item" USING btree ("post_id");
--> statement-breakpoint
-- List one research batch — the admin pipeline view.
CREATE INDEX IF NOT EXISTS "content_plan_item_batch_id_idx" ON "content_plan_item" USING btree ("batch_id");
