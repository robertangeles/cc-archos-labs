-- Migration 0039: knowledge_document provenance + explicit CDMP pool membership
--
-- Hand-written, matching the convention since 0031 (journal stops at 0030,
-- `db:generate` prompts on every out-of-sync table). Applied via
-- scripts/db-apply.mjs against __drizzle_applied.
--
-- Purely additive: three nullable/defaulted columns and one partial index.
-- No DROP, so no `-- safety:` header is required by the CI check. Idempotent.
--
--
-- WHY: TWO AXES WERE COLLAPSED INTO ONE
--
-- lib/cdmp/generate.ts:173 selects CDMP certification-exam source material with
--   searchKnowledge(chapter.label, "dmbok", n)
-- i.e. it treats the free-text `category` as if it meant "approved for the CDMP
-- exam". It does not. `category` is a TOPIC label, and the two questions are
-- genuinely different:
--
--   "is this book about data management?"        -> a topic question
--   "is a CDMP exam question drawn from this
--    book fair and in-syllabus?"                 -> a certification question
--
-- The Unified Star Schema is the case that proves they are different: squarely
-- data-management by topic, but built on a proprietary technique (the Bridge)
-- that is not DAMA syllabus. Under the old scheme there was no way to express
-- "yes to the first, no to the second".
--
-- Measured consequence in PROD on 2026-07-31: 8 of 19 ready documents carried
-- category='dmbok', and 6 of those 8 were wrong for the exam pool — The Trusted
-- Advisor, Flawless Consulting, Clean Architecture, The Pragmatic Programmer,
-- Designing Data-Intensive Applications and Data Strategy. Certification questions were being
-- generated from a book about consulting relationships. Identified by reading
-- sample chunks from every document; see
-- wiki/decisions/2026-07-31-corpus-taxonomy-and-cdmp-pool.md.
--
-- So pool membership becomes its own explicit boolean rather than a side effect
-- of a topic label. Default FALSE: a newly ingested document is NOT exam
-- material until someone says so. The bug existed because the old default was
-- effectively "yes, if you happened to type dmbok".
--
--
-- WHY author / publication_year
--
-- Several stored titles are raw filenames — one is literally
-- 'ABUIABA9GAAghIK0ugYowM2h3QY' (it is Chip Huyen's Designing Machine Learning
-- Systems). Since 2026-07-31 an internal-session Metis turn NAMES the work it
-- draws on, so these strings are user-facing. Author is stored separately
-- rather than mashed into the title so a citation can render "Flawless
-- Consulting — Peter Block" without string surgery.
--
-- 2NF holds: author and publication_year describe the document identified by
-- the primary key, not some other entity. A future `author` table would be
-- over-normalisation for 19 rows with no author-level attributes to store.

ALTER TABLE "knowledge_document"
  ADD COLUMN IF NOT EXISTS "author" text;
--> statement-breakpoint
ALTER TABLE "knowledge_document"
  ADD COLUMN IF NOT EXISTS "publication_year" integer;
--> statement-breakpoint
ALTER TABLE "knowledge_document"
  ADD COLUMN IF NOT EXISTS "is_cdmp_source" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- NOTE: this migration also created knowledge_document_cdmp_source_idx, a
-- partial index on (id) WHERE is_cdmp_source = true. Migration 0040 drops it.
-- It never did any work: the table has 19 rows and always seq-scans, and the
-- indexed key was already the primary key. The comment here originally claimed
-- it served the CDMP retrieval query, which was false. Left in place rather
-- than edited out of history so the 0040 rationale has something to point at.
CREATE INDEX IF NOT EXISTS "knowledge_document_cdmp_source_idx"
  ON "knowledge_document" ("id")
  WHERE "is_cdmp_source" = true;
--> statement-breakpoint

COMMENT ON COLUMN "knowledge_document"."is_cdmp_source" IS
  'Whether CDMP certification practice-exam questions may be generated from this document. NOT the same as category=''dmbok'': a book can be data-management by topic and still be out-of-syllabus for DAMA certification. Defaults false — new documents are not exam material until explicitly approved.';
--> statement-breakpoint
COMMENT ON COLUMN "knowledge_document"."author" IS
  'Author(s) as they should be cited, e.g. ''Peter Block''. User-facing: an internal-session Metis turn names the work it draws on.';
