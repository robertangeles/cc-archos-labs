-- Migration 0042: news radar (Release 1) — five new tables
--
-- Hand-written, matching the convention since 0031. Applied via
-- scripts/db-apply.mjs. Purely additive: five CREATE TABLE, their indexes and
-- constraints. No DROP, no change to any existing table. Idempotent.
--
--
-- WHY
--
-- The radar reads a news feed every two hours, has TypeSafe Jev score each item
-- against a frozen rubric, and shows a shortlist Rob labels Keep or Skip. These
-- tables hold the items, the scores, the labels, the rubric versions and a log
-- of finished ticks. Plan: ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md
-- (ENG-D3, D9 to D12).
--
-- The shortlist is NEVER stored. It is derived at read time from an item's own
-- scores and its cohort's frozen cut-offs. A cohort is the rubric version of an
-- item's earliest score row (ties: lowest version).
--
--
-- TABLES
--
--   news_candidate        one row per feed item; work state and the claim
--   news_radar_rubric     append-only rubric versions; the latest row is active
--   news_candidate_score  one row per (item, rubric version, question, model)
--   news_candidate_label  append-only Keep/Skip history, written by the admin API
--   news_radar_tick       one row per FINISHED tick; a crashed tick leaves none
--
--
-- DECISIONS WORTH KNOWING
--
-- * news_candidate.claimed_by is a random uuid minted per tick run, not the slot
--   or the tick row id. A retried or overlapping run of one slot must never share
--   a token with the run it replaces, or the stale-commit guard stops working.
--   The claim CHECK keeps the claim fields set exactly while status = 'scoring'.
-- * The FKs from score and label to news_candidate are RESTRICT, not CASCADE.
--   Labels are the evaluation ground truth and scores are the gate report's
--   evidence; a stray candidate DELETE must fail loudly.
-- * rubric_version in news_candidate_score and news_radar_tick is an FK to
--   news_radar_rubric(version), a UNIQUE identity column, not to its uuid id: an
--   integer version reads in the gate report and the CLI. Deliberate deviation
--   from the {table}_id naming rule.
-- * news_candidate_label.decision allows 'clear' (design decision DES-D6: pressing
--   the selected button un-labels an item). A latest 'clear' counts as unlabelled
--   in the gate report.
-- * Append-only tables still carry updated_at (repo rule); it is never written
--   after insert.
-- * JSONB columns (config, probabilities) are the CLAUDE.md audit exception.
--
--
-- ROLLBACK
--
-- Tables are additive and nothing else references them. To undo, drop in
-- reverse order: news_radar_tick, news_candidate_label, news_candidate_score,
-- news_radar_rubric, news_candidate. (Flag off and deleting the Render cron job
-- stops all writes first.)

CREATE TABLE IF NOT EXISTS "news_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"category" text,
	"published_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"claimed_by" uuid,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_candidate_source_url_unique" UNIQUE("source_url"),
	CONSTRAINT "news_candidate_status_check" CHECK ("status" IN ('new', 'scoring', 'scored', 'unscored', 'failed')),
	CONSTRAINT "news_candidate_claim_check" CHECK (("status" = 'scoring') = ("claimed_by" IS NOT NULL AND "claimed_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_radar_rubric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_radar_rubric_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_candidate_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"rubric_version" integer NOT NULL,
	"question_key" text NOT NULL,
	"model" text NOT NULL,
	"score" double precision NOT NULL,
	"confidence" double precision,
	"probabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_candidate_score_unique" UNIQUE("candidate_id", "rubric_version", "question_key", "model"),
	CONSTRAINT "news_candidate_score_candidate_id_news_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."news_candidate"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "news_candidate_score_rubric_fk" FOREIGN KEY ("rubric_version") REFERENCES "public"."news_radar_rubric"("version") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_candidate_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_candidate_label_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "news_candidate_label_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "news_candidate_label_decision_check" CHECK ("decision" IN ('keep', 'skip', 'clear')),
	CONSTRAINT "news_candidate_label_candidate_id_news_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."news_candidate"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_radar_tick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"scored" integer DEFAULT 0 NOT NULL,
	"unscored" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_class" text,
	"rubric_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_radar_tick_slot_at_unique" UNIQUE("slot_at"),
	CONSTRAINT "news_radar_tick_outcome_check" CHECK ("outcome" IN ('ok', 'partial', 'failed', 'disabled')),
	CONSTRAINT "news_radar_tick_rubric_version_news_radar_rubric_version_fk" FOREIGN KEY ("rubric_version") REFERENCES "public"."news_radar_rubric"("version") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
-- Work selection each tick: "oldest items still needing a score, including
-- expired claims". Partial: scored and failed rows are the vast majority.
CREATE INDEX IF NOT EXISTS "news_candidate_work_idx" ON "news_candidate" USING btree ("first_seen_at") WHERE "status" IN ('new', 'unscored', 'scoring');
--> statement-breakpoint
-- The Radar page list and the gate report: "items newest first".
CREATE INDEX IF NOT EXISTS "news_candidate_published_at_idx" ON "news_candidate" USING btree ("published_at" DESC, "id");
--> statement-breakpoint
-- The rubric_version FK index and the page/gate query "scores of this cohort
-- for this question". The unique constraint on (candidate_id, rubric_version,
-- question_key, model) already serves the candidate_id FK and "scores of one
-- item" (candidate_id leads).
CREATE INDEX IF NOT EXISTS "news_candidate_score_version_question_idx" ON "news_candidate_score" USING btree ("rubric_version", "question_key");
--> statement-breakpoint
-- The candidate_id FK index and "latest label per item" (page and gate report).
CREATE INDEX IF NOT EXISTS "news_candidate_label_candidate_sequence_idx" ON "news_candidate_label" USING btree ("candidate_id", "sequence" DESC);
--> statement-breakpoint
-- The rubric_version FK index: "ticks that ran under this version".
CREATE INDEX IF NOT EXISTS "news_radar_tick_rubric_version_idx" ON "news_radar_tick" USING btree ("rubric_version");
