-- Posts Admin (Phase D) — featured-image metadata expansion.
--
-- Extends the `post` table with 11 new columns describing the featured
-- image. NO new tables (the users table lands separately in 0015). The
-- existing single-image-per-post model is preserved.
--
-- All new columns are NULLABLE so the 253 migrated posts (which today
-- have og_image_path set but no other metadata) keep working — the
-- columns get populated by the upload route OR by the backfill pass
-- (scripts/backfill-og-image-alt.mjs, runs after this migration lands).
--
-- Constraints applied:
--   - CHECK on og_image_mime_type — PNG / JPEG / WebP only. Applies
--     when SET; NULL passes (existing rows grandfathered).
--   - CHECK on og_image_size_kb — max 500 KB at the DB level. Applies
--     when SET; NULL passes. Application layer additionally warns at
--     150 KB.
--   - FK on og_image_uploaded_by → users.id. ON DELETE SET NULL so a
--     deleted user doesn't cascade-blank a post's image metadata.
--
-- Alt-text-required constraint is DEFERRED. Per the audit, 165 of 253
-- WP posts had alt text in the source; the backfill script populates
-- those (and pre-fills the remaining 88 with post title as alt per the
-- accepted decision). Migration 0017 will add the NOT VALID
-- CHECK constraint after backfill verification.
--
-- Indexes added:
--   - og_image_uploaded_by — FK lookup, "list a user's uploaded
--     images". Mandatory per CLAUDE.md "every FK gets an index".
--   - og_image_checksum — sha256 dedupe lookups when the admin
--     re-uploads. Partial (only rows with a checksum participate).
--   - og_image_deleted_at — future R2 cleanup job ("find rows
--     soft-deleted past grace period"). Partial.
--
-- Additive + reversible: every column nullable, every constraint
-- permissive on NULL. Rollback = DROP COLUMN x11 + DROP CONSTRAINT x3
-- + DROP INDEX x3. Safe against live data.

ALTER TABLE "post"
  ADD COLUMN "og_image_alt" text,
  ADD COLUMN "og_image_width" integer,
  ADD COLUMN "og_image_height" integer,
  ADD COLUMN "og_image_filename" text,
  ADD COLUMN "og_image_mime_type" text,
  ADD COLUMN "og_image_size_kb" integer,
  ADD COLUMN "og_image_uploaded_by" uuid,
  ADD COLUMN "og_image_uploaded_at" timestamp with time zone,
  ADD COLUMN "og_image_checksum" text,
  ADD COLUMN "og_image_r2_key" text,
  ADD COLUMN "og_image_deleted_at" timestamp with time zone;
--> statement-breakpoint

-- FK to the users table created in 0015.
ALTER TABLE "post"
  ADD CONSTRAINT "post_og_image_uploaded_by_users_id_fk"
  FOREIGN KEY ("og_image_uploaded_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

-- Allowed mime types: PNG, JPEG, WebP. (.jpg and .jpeg both serialise
-- to image/jpeg, so two values cover three extensions.)
ALTER TABLE "post"
  ADD CONSTRAINT "post_og_image_mime_type_check"
  CHECK (
    "og_image_mime_type" IS NULL
    OR "og_image_mime_type" IN ('image/png', 'image/jpeg', 'image/webp')
  );
--> statement-breakpoint

-- Max 500 KB per featured image (app layer additionally warns at 150).
ALTER TABLE "post"
  ADD CONSTRAINT "post_og_image_size_kb_check"
  CHECK (
    "og_image_size_kb" IS NULL
    OR "og_image_size_kb" <= 500
  );
--> statement-breakpoint

-- Mandatory FK index (CLAUDE.md: every FK column gets an index).
CREATE INDEX "post_og_image_uploaded_by_idx"
  ON "post" ("og_image_uploaded_by");
--> statement-breakpoint

-- Partial index for sha256 dedupe lookups on upload.
CREATE INDEX "post_og_image_checksum_idx"
  ON "post" ("og_image_checksum")
  WHERE "og_image_checksum" IS NOT NULL;
--> statement-breakpoint

-- Partial index for the future R2 cleanup job.
CREATE INDEX "post_og_image_deleted_at_idx"
  ON "post" ("og_image_deleted_at")
  WHERE "og_image_deleted_at" IS NOT NULL;
