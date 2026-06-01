-- Phase B: add user_id to assessment_session and magic_link_token
-- Purely additive — no data migration, no column drops.

-- assessment_session: site-wide account owner for new sessions
ALTER TABLE "assessment_session" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "assessment_session"
  ADD CONSTRAINT "assessment_session_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "assessment_session_user_id_idx"
  ON "assessment_session" USING btree ("user_id");

-- magic_link_token: allow user-keyed tokens (Phase B passwordless return)
ALTER TABLE "magic_link_token" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "magic_link_token"
  ADD CONSTRAINT "magic_link_token_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "magic_link_token_user_id_idx"
  ON "magic_link_token" USING btree ("user_id");

-- magic_link_token: make lead_id nullable for user-only tokens
ALTER TABLE "magic_link_token" ALTER COLUMN "lead_id" DROP NOT NULL;
