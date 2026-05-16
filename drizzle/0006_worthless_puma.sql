-- Add consultant.slug for the public booking URL.
--
-- The generated `ADD COLUMN ... NOT NULL` failed against the existing row,
-- so we split into four steps:
--   1) add column nullable
--   2) backfill from the email local part (lowercase, non-alphanumerics → hyphen)
--   3) flip to NOT NULL
--   4) add the unique constraint
--
-- After this migration the admin can rename the slug from /admin/integrations
-- (future profile UI). The default value is just deterministic enough to make
-- the existing row valid without a manual step.

ALTER TABLE "consultant" ADD COLUMN "slug" text;--> statement-breakpoint

UPDATE "consultant"
SET "slug" = lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE "slug" IS NULL;--> statement-breakpoint

ALTER TABLE "consultant" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "consultant" ADD CONSTRAINT "consultant_slug_unique" UNIQUE("slug");
