-- Migration 0041: message.sources — which works an answer was grounded in
--
-- Hand-written, matching the convention since 0031. Applied via
-- scripts/db-apply.mjs. Purely additive: one nullable jsonb column, no DROP,
-- no index. Idempotent.
--
--
-- WHY
--
-- Metis names the works it draws on inside its prose ("Block's point about
-- naming the resistance"). That is attribution, not verification: the reader
-- has no way to tell a work it actually read from a work it recalled from
-- training and dressed up as a retrieval.
--
-- The citation strip closes that. It lists what was ACTUALLY put in front of
-- the model, which is a different fact from what the model chose to mention —
-- and a work named in prose that does not appear in the strip is a fabricated
-- attribution, which nothing currently catches.
--
-- Stored rather than computed so a citation survives a page reload. A citation
-- that disappears on refresh is half a feature: the one moment you most want to
-- check a claim is when you come back to it later.
--
--
-- SHAPE, AND WHY JSONB
--
--   [{"title": "Flawless Consulting (2nd Edition)", "author": "Peter Block"}]
--
-- This is a display snapshot, not a relation. A message_source join table would
-- be the normalised form, but the strip must keep showing what the answer was
-- grounded in AT THE TIME even if the document is later retagged, retitled or
-- deleted — exactly what happened to 19 documents earlier today. A foreign key
-- would make the citation mutate under a historical answer, or vanish with the
-- row. The JSONB audit/snapshot exception in the project's DB standards covers
-- precisely this case, the same way conversation_share snapshots its content.
--
-- No index: sources are only ever read on a row already fetched by
-- conversation_id (the chat pane) — never filtered, joined or sorted on.
--
-- NULL means "no citation recorded", which covers every message written before
-- this column existed, every user message, and every ungrounded answer.

ALTER TABLE "message"
  ADD COLUMN IF NOT EXISTS "sources" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "message"."sources" IS
  'Snapshot of the works this answer was grounded in, as [{title, author}]. Display metadata for the citation strip, deliberately denormalised so a citation keeps showing what was true at answer time even if the document is later retagged or removed. NULL = no citation recorded.';
