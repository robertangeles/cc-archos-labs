-- Chat Attach Files: user-owned documents + conversation join.
-- Additive, idempotent (db-apply runs these non-transactionally). FKs are inline
-- (created with the table) so re-runs are safe. Indexes/unique use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"storage_key" text,
	"extracted_text" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversation_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "conversation"("id") ON DELETE cascade,
	"document_id" uuid NOT NULL REFERENCES "document"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Owner scope + reuse picker: list a user's documents.
CREATE INDEX IF NOT EXISTS "document_user_id_idx" ON "document" USING btree ("user_id");--> statement-breakpoint
-- Per-user dedup lookup (NON-unique in v1 — no dedup-attach, so no filename aliasing).
CREATE INDEX IF NOT EXISTS "document_user_id_content_hash_idx" ON "document" USING btree ("user_id","content_hash");--> statement-breakpoint
-- Injection hot path: a conversation's attached documents.
CREATE INDEX IF NOT EXISTS "conversation_document_conversation_id_idx" ON "conversation_document" USING btree ("conversation_id");--> statement-breakpoint
-- Ref-count: which conversations reference a document.
CREATE INDEX IF NOT EXISTS "conversation_document_document_id_idx" ON "conversation_document" USING btree ("document_id");--> statement-breakpoint
-- A document attaches at most once per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_document_conversation_id_document_id_key" ON "conversation_document" USING btree ("conversation_id","document_id");
