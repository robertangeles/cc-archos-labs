-- Migration 0033: user_memory consolidation columns (distillation layer)
--
-- Adds the columns the distillation layer needs to store CLEAN atomic facts
-- with supersede-on-conflict instead of raw chat turns:
--   is_active               — a fact is superseded (is_active=false), never
--                             hard-deleted, when a newer fact contradicts it.
--   superseded_at           — when it was superseded.
--   source_conversation_id  — provenance pointer (no FK; soft reference).
--
-- All additive + idempotent.

ALTER TABLE "user_memory" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_memory" ADD COLUMN IF NOT EXISTS "source_conversation_id" uuid;
--> statement-breakpoint
-- Recall/list pre-filter over LIVE facts only:
--   SELECT ... FROM user_memory WHERE user_id = $1 AND is_active [ORDER BY embedding <=> $2]
CREATE INDEX IF NOT EXISTS "user_memory_user_active_idx" ON "user_memory" USING btree ("user_id") WHERE is_active;
--> statement-breakpoint
-- Double-insert guard: the same active fact text can't be stored twice for a
-- user. Consolidation INSERTs use ON CONFLICT (user_id, md5(body)) WHERE
-- is_active DO NOTHING against this partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "user_memory_user_body_active_uidx" ON "user_memory" ("user_id", md5("body")) WHERE is_active;
