-- Rename the auto-derived consultant slug to a brand-aligned one.
--
-- Migration 0006 backfilled the slug from the email local part for the
-- existing row, which produced "trebor-selegna" — fine as a placeholder
-- but ugly as a public booking URL. The home-page CTA in this PR
-- (PR #42) points at /book/archos-labs, so this rename keeps the
-- consultant row aligned with the live URL.
--
-- WHERE filter scoped narrowly so this is a no-op on any DB where the
-- existing row already has a different slug.

UPDATE "consultant"
SET "slug" = 'archos-labs'
WHERE "slug" = 'trebor-selegna';
