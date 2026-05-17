-- Remove the arbitrary `Asia/Manila` default from consultant.timezone
-- and fix the only existing row that picked it up.
--
-- Drizzle generates the ALTER for the schema default change; we extend
-- the migration with an UPDATE so the existing Asia/Manila value (set
-- by the old default when the OAuth callback created the consultant
-- row) flips to the consultant's actual timezone.
--
-- Future consultants get UTC as a placeholder and must overwrite it
-- explicitly via the profile UI (lands in a follow-up PR).

ALTER TABLE "consultant" ALTER COLUMN "timezone" SET DEFAULT 'UTC';--> statement-breakpoint

UPDATE "consultant"
SET "timezone" = 'Australia/Sydney'
WHERE "timezone" = 'Asia/Manila';
