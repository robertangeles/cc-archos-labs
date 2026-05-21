-- Users table — foundation for multi-user admin.
--
-- Single admin today (one password verified in lib/auth.ts, JWT subject
-- claim 'admin'). This table is the structural scaffold so future PRs
-- can:
--   - Add a real users.email lookup at login
--   - Migrate from password-only auth to per-user accounts
--   - FK uploaded-by / saved-by / authored-by columns to users.id
--     (starts with post.og_image_uploaded_by in migration 0016)
--
-- Auth itself is NOT changed here. lib/auth.ts continues to verify a
-- single password from integration_secrets and mint a JWT with
-- sub='admin'. The seed row below is the row that future uploaded-by
-- FKs resolve to until per-user login ships.
--
-- 'role' is text (not enum) for forward flexibility — promote to a
-- pgEnum once we know which other roles we need (author, reviewer,
-- viewer, etc.).

CREATE TABLE "users" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"         text NOT NULL UNIQUE,
  "display_name"  text,
  "role"          text NOT NULL DEFAULT 'admin',
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "last_login_at" timestamp with time zone
);
--> statement-breakpoint

-- Seed the existing single-admin row. Email 'admin' matches the JWT
-- subject claim minted by lib/auth.ts today (sub='admin'). When real
-- per-user login lands, this row gets its email rewritten to Rob's
-- actual address and the sub claim source flips to user.email.
INSERT INTO "users" ("email", "role")
VALUES ('admin', 'admin');
