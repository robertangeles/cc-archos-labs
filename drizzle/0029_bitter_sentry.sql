-- CDMP Specialist exams: chapter tag on knowledge_chunk. Purely additive.
-- NULL = front/back matter or unassignable (excluded from specialist pools).
ALTER TABLE "knowledge_chunk" ADD COLUMN IF NOT EXISTS "chapter" text;--> statement-breakpoint
-- CDMP specialist generation: "fetch all chunks for one chapter."
CREATE INDEX IF NOT EXISTS "knowledge_chunk_chapter_idx" ON "knowledge_chunk" USING btree ("chapter");