-- Migration 0043: news draft pipeline (Release 2) — two new tables
--
-- Hand-written, matching the convention since 0031. Applied via
-- scripts/db-apply.mjs. Purely additive: two CREATE TABLE, their indexes and
-- constraints. No DROP, no change to any existing table. Idempotent.
--
--
-- WHY
--
-- Release 1 (0042) finds and scores stories and lets Rob label them Keep or
-- Skip. Release 2 turns a Kept story into a reviewed blog post: find and verify
-- the primary source, write, tighten, illustrate, schedule. One row in
-- news_draft_job follows one story through that; one row per finished stage in
-- news_draft_step keeps what each stage produced and what it cost.
--
--
-- TABLES
--
--   news_draft_job   one row per Kept story: status, lease, attempts, the post
--                    it produced, or why a human is needed
--   news_draft_step  one row per finished stage (research, thesis, steelman,
--                    essay, each judge and rewrite, photo, image)
--
--
-- DECISIONS WORTH KNOWING
--
-- * candidate_id, not news_candidate_id: the same deliberate deviation from the
--   {table}_id rule that news_candidate_score and news_candidate_label make, so
--   the news_* family reads the same. job_id on news_draft_step likewise.
-- * One job per story (UNIQUE candidate_id). A story is drafted once; a human who
--   wants a redraft clears the row on purpose.
-- * The lease (claimed_by + claimed_until) exists exactly while status =
--   'running', enforced by a CHECK, as on news_candidate. claimed_by is a random
--   uuid minted per run, so a replaced run can never commit as the run that
--   replaced it.
-- * A job that loses its process is restarted from its first stage (attempts
--   counts the tries), not resumed: stage outputs are an audit trail, not a
--   checkpoint. Simpler, and a restart is rare.
-- * needs_attention and failed both carry a reason. needs_attention means "a
--   person must look" (no verified primary source, a failed check); failed means
--   the machinery gave up (lease lost too many times).
-- * post_id is ON DELETE SET NULL: removing a post must not remove the record
--   that the story was drafted.
-- * FKs to news_candidate and from step to job are RESTRICT, as in 0042: this is
--   evidence of what the pipeline did.
-- * cost_usd is numeric, not float: it is summed in reports.
--
--
-- ROLLBACK
--
-- Nothing else references these tables. Drop news_draft_step, then
-- news_draft_job. Turn the news_draft_enabled flag off first so nothing writes.

CREATE TABLE IF NOT EXISTS "news_draft_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"claimed_by" uuid,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"post_id" uuid,
	"attention_reason" text,
	"attention_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_draft_job_candidate_id_unique" UNIQUE("candidate_id"),
	CONSTRAINT "news_draft_job_candidate_id_news_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."news_candidate"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
	CONSTRAINT "news_draft_job_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
	CONSTRAINT "news_draft_job_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'needs_attention', 'failed', 'cancelled')),
	CONSTRAINT "news_draft_job_lease_check" CHECK (("status" = 'running') = ("claimed_by" IS NOT NULL AND "claimed_until" IS NOT NULL)),
	CONSTRAINT "news_draft_job_reason_check" CHECK (("status" IN ('needs_attention', 'failed')) = ("attention_reason" IS NOT NULL)),
	CONSTRAINT "news_draft_job_finished_check" CHECK (("status" IN ('succeeded', 'needs_attention', 'failed', 'cancelled')) = ("finished_at" IS NOT NULL)),
	CONSTRAINT "news_draft_job_post_check" CHECK ("post_id" IS NULL OR "status" = 'succeeded')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_draft_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_draft_step_unique" UNIQUE("job_id", "step_key", "attempt"),
	CONSTRAINT "news_draft_step_job_id_news_draft_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."news_draft_job"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
	CONSTRAINT "news_draft_step_status_check" CHECK ("status" IN ('ok', 'failed')),
	CONSTRAINT "news_draft_step_attempt_check" CHECK ("attempt" >= 1)
);
--> statement-breakpoint
-- Serves the work selection every run: "oldest queued job" and "running jobs
-- whose lease expired". Partial: finished jobs are almost all of the table.
CREATE INDEX IF NOT EXISTS "news_draft_job_work_idx" ON "news_draft_job" USING btree ("created_at") WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
-- Serves the daily cap: "how many jobs started on this Melbourne day". Partial:
-- a job that never started has no started_at.
CREATE INDEX IF NOT EXISTS "news_draft_job_started_at_idx" ON "news_draft_job" USING btree ("started_at") WHERE "started_at" IS NOT NULL;
--> statement-breakpoint
-- FK index (every FK gets one): "which job made this post", and the SET NULL scan
-- when a post is deleted. Partial: most rows never reach a post.
CREATE INDEX IF NOT EXISTS "news_draft_job_post_id_idx" ON "news_draft_job" USING btree ("post_id") WHERE "post_id" IS NOT NULL;
