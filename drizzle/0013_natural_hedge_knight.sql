-- Translation Layer Phase A1 (rosy-bee).
--
-- Adds five tables for the WordPress → Archos Labs blog migration:
--   - author             — editorial authors (single-row today: Rob)
--   - category           — Yoast-source taxonomy (4 seeded categories
--                          land in a follow-up via seed script, NOT here)
--   - post               — time-stamped editorial under /blog
--   - post_revision      — append-only audit trail (mirrors page_revision)
--   - newsletter_signup  — capture + double-opt-in (Resend Audiences)
--
-- Enables the pgvector extension and creates the HNSW index for
-- post.embedding (1024-dim Voyage voyage-3-large) — powers the
-- read-next widget and /search ANN queries.
--
-- CREATE EXTENSION requires `rds_superuser` (Render Postgres default user
-- has this). If the migration aborts at the first statement, enable the
-- vector extension via the Render dashboard (Database → Extensions) and
-- re-run. The migration is idempotent (IF NOT EXISTS) so the re-run is
-- safe.
--
-- Public routes (/blog, /blog/[slug], /search) are NOT shipped in this
-- PR — schema is additive, zero rows until the migration script runs.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "author" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"bio_md" text DEFAULT '' NOT NULL,
	"photo_url" text,
	"linkedin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "newsletter_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"source_post_id" uuid,
	"confirmed_at" timestamp with time zone,
	"double_opt_in_token" text,
	"token_issued_at" timestamp with time zone,
	"utm_source" text,
	"utm_campaign" text,
	"ip_hash" text,
	"ua_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_signup_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content_md" text DEFAULT '' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"og_image_path" text,
	"og_image_generated_at" timestamp with time zone,
	"author_id" uuid,
	"category_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'listed' NOT NULL,
	"embedding" vector(1024),
	"word_count" integer DEFAULT 0 NOT NULL,
	"reading_time_min" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"source_wp_id" integer,
	"last_reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "post_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"excerpt" text,
	"seo_title" text,
	"seo_description" text,
	"diff_size_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"saved_by" text DEFAULT 'admin' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_signup" ADD CONSTRAINT "newsletter_signup_source_post_id_post_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_author_id_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."author"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_revision" ADD CONSTRAINT "post_revision_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_signup_source_post_id_idx" ON "newsletter_signup" USING btree ("source_post_id");--> statement-breakpoint
CREATE INDEX "newsletter_signup_token_idx" ON "newsletter_signup" USING btree ("double_opt_in_token");--> statement-breakpoint
CREATE INDEX "newsletter_signup_confirmed_at_idx" ON "newsletter_signup" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "post_status_visibility_published_at_idx" ON "post" USING btree ("status","visibility","published_at");--> statement-breakpoint
CREATE INDEX "post_category_id_idx" ON "post" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "post_author_id_idx" ON "post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "post_archived_at_idx" ON "post" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "post_source_wp_id_idx" ON "post" USING btree ("source_wp_id");--> statement-breakpoint
CREATE INDEX "post_needs_review_idx" ON "post" USING btree ("needs_review") WHERE needs_review = true;--> statement-breakpoint
CREATE INDEX "post_revision_post_id_saved_at_idx" ON "post_revision" USING btree ("post_id","saved_at");--> statement-breakpoint

-- pgvector HNSW index for read-next + /search ANN queries.
--   SELECT ... ORDER BY embedding <=> $1 LIMIT 3
-- Cosine distance matches Voyage voyage-3-large normalised embeddings.
-- Parameters m=16, ef_construction=64 are sensible defaults; tune
-- ef_search at query time if recall/latency tradeoffs need adjustment.
CREATE INDEX "post_embedding_hnsw_idx" ON "post" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);