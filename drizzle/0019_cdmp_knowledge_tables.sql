-- CDMP Practice Exam + Knowledge Base tables
-- Migration 0019: adds knowledge_document, knowledge_chunk,
-- cdmp_exam_session, cdmp_exam_answer, cdmp_question_flag

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- knowledge_document
-- ============================================================================

CREATE TABLE IF NOT EXISTS "knowledge_document" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "source_type" text NOT NULL,
  "category" text,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'processing' NOT NULL,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_document_content_hash_unique" UNIQUE("content_hash")
);

-- ============================================================================
-- knowledge_chunk
-- ============================================================================

CREATE TABLE IF NOT EXISTS "knowledge_chunk" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "knowledge_document"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "embedding" vector(1024),
  "chunk_index" integer NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "knowledge_chunk_document_id_idx"
  ON "knowledge_chunk" USING btree ("document_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunk_document_id_chunk_index_idx"
  ON "knowledge_chunk" USING btree ("document_id", "chunk_index");

-- HNSW index for vector search (cosine distance)
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embedding_hnsw_idx"
  ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- cdmp_exam_session
-- ============================================================================

CREATE TABLE IF NOT EXISTS "cdmp_exam_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "question_count" integer NOT NULL,
  "correct_count" integer,
  "score_percent" integer,
  "passed" boolean,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cdmp_exam_session_user_id_idx"
  ON "cdmp_exam_session" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "cdmp_exam_session_status_idx"
  ON "cdmp_exam_session" USING btree ("status");

-- ============================================================================
-- cdmp_exam_answer
-- ============================================================================

CREATE TABLE IF NOT EXISTS "cdmp_exam_answer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "cdmp_exam_session"("id") ON DELETE CASCADE,
  "question_index" integer NOT NULL,
  "question_text" text NOT NULL,
  "options" jsonb NOT NULL,
  "user_answer" text NOT NULL,
  "correct_answer" text NOT NULL,
  "is_correct" boolean NOT NULL,
  "knowledge_area" text NOT NULL,
  "explanation" text NOT NULL,
  "dmbok_chapter_ref" text NOT NULL,
  "chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cdmp_exam_answer_session_id_idx"
  ON "cdmp_exam_answer" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "cdmp_exam_answer_knowledge_area_idx"
  ON "cdmp_exam_answer" USING btree ("knowledge_area");

-- ============================================================================
-- cdmp_question_flag
-- ============================================================================

CREATE TABLE IF NOT EXISTS "cdmp_question_flag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "answer_id" uuid NOT NULL REFERENCES "cdmp_exam_answer"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cdmp_question_flag_answer_id_idx"
  ON "cdmp_question_flag" USING btree ("answer_id");
CREATE INDEX IF NOT EXISTS "cdmp_question_flag_user_id_idx"
  ON "cdmp_question_flag" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "cdmp_question_flag_status_idx"
  ON "cdmp_question_flag" USING btree ("status");
