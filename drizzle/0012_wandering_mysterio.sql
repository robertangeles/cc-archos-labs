-- Pages CMS Phase 2 — section blocks for composed pages.
--
-- - Adds `page_block` table: one row per block in a composed page,
--   keyed by `block_type` into the lib/pages/blocks/registry. Props are
--   jsonb validated against the registry's Zod schema at save + render.
-- - Adds `page_revision.blocks_snapshot jsonb` column for audit. NULL
--   when the page is long_form (content lives in content_md); populated
--   when composed.
-- - Schema is additive only. Zero rows in page_block until the first
--   composed page is created in admin.

CREATE TABLE "page_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"block_type" text NOT NULL,
	"position" integer NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_revision" ADD COLUMN "blocks_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "page_block" ADD CONSTRAINT "page_block_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_block_page_id_position_idx" ON "page_block" USING btree ("page_id","position");