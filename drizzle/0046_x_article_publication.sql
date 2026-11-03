-- Migration 0046: X Article publishing queue — one new table
--
-- Hand-written, matching the convention since 0031 (never `pnpm db:generate`:
-- the drizzle snapshot stops at 0030). Applied via scripts/db-apply.mjs. Purely
-- additive: one CREATE TABLE, its indexes and constraints. No change to any
-- existing table. Idempotent.
--
--
-- WHY
--
-- Every blog post that goes live is also posted to X as an Article. X has no
-- edit, delete, get or schedule call for Articles, so what we did on X must be
-- recorded here, and the database refuses states that would let a retry act on
-- a false record (for example a published row with no X post id). One row
-- follows one post:
--
--   queued -> working -> drafted -> publishing -> published        (terminal)
--                 |          '--> draft_only                       (terminal)
--                 '-- release -> queued / drafted
--   any -> skipped (post no longer public) | needs_attention (a person looks)
--
-- lib/x-articles/queue.ts is the only writer; see its header for the transitions.
--
--
-- DECISIONS WORTH KNOWING
--
-- * One row per post (UNIQUE post_id). The sweep inserts with ON CONFLICT DO
--   NOTHING, so running it every tick is safe.
-- * post_id is ON DELETE RESTRICT: this row is the only record of what was
--   posted publicly under the brand account, so a post with a row cannot be
--   removed by accident.
-- * The lease (claimed_by + claimed_until) exists exactly while the status is
--   'working' or 'publishing', enforced by a CHECK. A drafted row at rest holds
--   no lease. claimed_by is a random uuid minted per claim, so a replaced worker
--   can never commit as the worker that replaced it.
-- * article_id and x_post_id are text: X ids are 19-digit strings that overflow
--   a JavaScript number.
-- * attempts counts runs that died holding the row (and X refusing a draft with
--   a 503, which burns one of X's 10 daily draft calls); other transient X
--   failures do not touch it.
-- * attention_detail never holds article text, only X's status and error code.
--
--
-- ROLLBACK
--
-- Nothing else references this table. Set the X mode to Off on the Integrations
-- card first so nothing writes, then remove the table.

CREATE TABLE IF NOT EXISTS "x_article_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"claimed_by" uuid,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"article_id" text,
	"x_post_id" text,
	"cover_status" text DEFAULT 'none' NOT NULL,
	"attention_reason" text,
	"attention_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Serves the sweep's ON CONFLICT (post_id) and the post_id FK: "does this post already have a row".
	CONSTRAINT "x_article_publication_post_id_unique" UNIQUE("post_id"),
	CONSTRAINT "x_article_publication_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
	CONSTRAINT "x_article_publication_status_check" CHECK ("status" IN ('queued', 'working', 'drafted', 'publishing', 'draft_only', 'published', 'needs_attention', 'skipped')),
	CONSTRAINT "x_article_publication_lease_check" CHECK (("status" IN ('working', 'publishing')) = ("claimed_by" IS NOT NULL AND "claimed_until" IS NOT NULL)),
	CONSTRAINT "x_article_publication_article_check" CHECK ("status" NOT IN ('drafted', 'publishing', 'draft_only', 'published') OR "article_id" IS NOT NULL),
	CONSTRAINT "x_article_publication_published_check" CHECK (("status" = 'published') = ("x_post_id" IS NOT NULL)),
	CONSTRAINT "x_article_publication_reason_check" CHECK (("status" IN ('needs_attention', 'skipped')) = ("attention_reason" IS NOT NULL)),
	CONSTRAINT "x_article_publication_cover_status_check" CHECK ("cover_status" IN ('none', 'uploaded', 'failed'))
);
--> statement-breakpoint
-- Serves claimBatch every tick: "queued or drafted rows due now, oldest first".
-- Partial: finished rows are almost all of the table.
CREATE INDEX IF NOT EXISTS "x_article_publication_due_idx" ON "x_article_publication" USING btree ("next_attempt_at") WHERE "status" IN ('queued', 'drafted');
--> statement-breakpoint
-- Serves recoverStale every tick: "working or publishing rows whose lease expired".
CREATE INDEX IF NOT EXISTS "x_article_publication_lease_idx" ON "x_article_publication" USING btree ("claimed_until") WHERE "status" IN ('working', 'publishing');
--> statement-breakpoint
-- Serves the health check: "how many rows need a person, and since when".
CREATE INDEX IF NOT EXISTS "x_article_publication_attention_idx" ON "x_article_publication" USING btree ("updated_at") WHERE "status" = 'needs_attention';
