-- Migration 0032: user_memory — in-app per-user chat memory (pgvector)
--
-- Replaces the external GBrain service. OLTP, 2NF: every non-key column
-- depends only on the primary key (id). The `embedding` vector column is
-- the documented pgvector exception to the no-blob rule.
--
-- Recall is an exact cosine scan over ONE user's slice, so this table has
-- deliberately NO ANN index (HNSW/ivfflat): a tenant-filtered ANN index
-- under-recalls, and per-user slices are small enough that an exact scan is
-- both correct and fast. The only index is the btree on user_id that the
-- recall pre-filter and the Brain-page listing both scan.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text DEFAULT 'chat' NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_memory_user_id_users_id_fk') THEN
  ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
-- FK-backed recall pre-filter + Brain-page listing:
--   SELECT ... FROM user_memory WHERE user_id = $1 [ORDER BY embedding <=> $2]
CREATE INDEX IF NOT EXISTS "user_memory_user_id_idx" ON "user_memory" USING btree ("user_id");
