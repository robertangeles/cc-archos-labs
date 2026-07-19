-- Migration 0035: workspace_memory — org-scoped shared memory tier (pgvector)
--
-- The counterpart to per-user user_memory. Workspace entities (projects,
-- clients, social posts, skills, kanban cards) are distilled into atomic facts
-- and embedded here so chat recall grounds in the whole org's book of work.
-- OLTP, 2NF: every non-key column depends only on the primary key (id). The
-- `embedding` vector column is the documented pgvector exception.
--
-- Unlike user_memory (tiny per-user slices, exact cosine scan, NO ANN index),
-- this shared tier spans many entities across a team, so it gets an HNSW ANN
-- index — matching post.embedding / knowledge_chunk.embedding. This DEVIATES
-- from the written ivfflat DB standard; justified by consistency with the two
-- HNSW vector indexes already operated (one fewer index type to reason about).
-- Recall filters by organisation_id (the isolation boundary) + is_active.
--
-- All additive + idempotent.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_entity_id" uuid,
	"title" text,
	"body" text NOT NULL,
	"embedding" vector(1024),
	"is_active" boolean DEFAULT true NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memory_organisation_id_organisation_id_fk') THEN
  ALTER TABLE "workspace_memory" ADD CONSTRAINT "workspace_memory_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
-- FK-backed recall pre-filter: WHERE organisation_id = $1.
CREATE INDEX IF NOT EXISTS "workspace_memory_org_id_idx" ON "workspace_memory" USING btree ("organisation_id");
--> statement-breakpoint
-- Recall/list over LIVE facts only: WHERE organisation_id = $1 AND is_active.
CREATE INDEX IF NOT EXISTS "workspace_memory_org_active_idx" ON "workspace_memory" USING btree ("organisation_id") WHERE is_active;
--> statement-breakpoint
-- Ingest hook: find an entity's facts to supersede/deactivate on source
-- update/delete — WHERE source_type = $1 AND source_entity_id = $2.
CREATE INDEX IF NOT EXISTS "workspace_memory_source_idx" ON "workspace_memory" USING btree ("source_type", "source_entity_id");
--> statement-breakpoint
-- HNSW ANN index for shared-tier recall: ORDER BY embedding <=> $vec. Matches
-- post_embedding_hnsw_idx (m = 16, ef_construction = 64).
CREATE INDEX IF NOT EXISTS "workspace_memory_embedding_hnsw_idx" ON "workspace_memory" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
-- Double-insert guard: the same active fact text can't be stored twice for an
-- org. Consolidation INSERTs use ON CONFLICT (organisation_id, md5(body))
-- WHERE is_active DO NOTHING against this partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_memory_org_body_active_uidx" ON "workspace_memory" ("organisation_id", md5("body")) WHERE is_active;
