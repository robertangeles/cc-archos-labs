-- safety: verified against origin/main on 2026-11-02 by Rob Angeles
--
-- Migration 0045: drop Model Studio (5 tables) and its feature flag row
--
-- Hand-written, matching the convention since 0031. Applied via
-- scripts/db-apply.mjs. DESTRUCTIVE: 5 DROP TABLE and one targeted DELETE.
-- Idempotent (IF EXISTS; the DELETE matches nothing the second time).
-- Take a pg_dump first. Run it on PROD only AFTER the code that stops using
-- these tables has deployed: the previous release still serves /workspace/model-studio.
--
--
-- WHY
--
-- Rob removed Model Studio from the Metis workspace. The pages, /api/model-studio,
-- hooks, components and the @xyflow/react dependency went in the same change.
-- These tables have no reader left.
--
--
-- WHAT GOES
--
--   data_model               one row per model, owned by a project and a user
--   data_model_entity        entities on the canvas
--   data_model_attribute     attributes of an entity
--   data_model_relationship  relationships between two entities
--   data_model_canvas_state  per-user per-layer node positions
--
-- and the site_setting row with key 'model_studio', the feature flag the page
-- read (default off when the row is absent). Only that exact key is deleted.
--
--
-- ORDER
--
-- Children before parents, and no CASCADE, so an unexpected dependent makes the
-- migration fail instead of silently dropping something else. Every foreign key
-- that points at these tables was listed from pg_constraint on DEV first; all of
-- them sit inside this set:
--
--   data_model_attribute, data_model_relationship  -> data_model_entity, data_model
--   data_model_canvas_state, data_model_entity     -> data_model
--
-- data_model itself points at project and users; dropping it removes those
-- outgoing foreign keys and touches neither table.
--
--
-- DATA LOST
--
-- Every data model, entity, attribute, relationship and saved canvas layout.
-- DEV held none of them (all five tables had zero rows).

DROP TABLE IF EXISTS "data_model_attribute";--> statement-breakpoint
DROP TABLE IF EXISTS "data_model_relationship";--> statement-breakpoint
DROP TABLE IF EXISTS "data_model_canvas_state";--> statement-breakpoint
DROP TABLE IF EXISTS "data_model_entity";--> statement-breakpoint
DROP TABLE IF EXISTS "data_model";--> statement-breakpoint
DELETE FROM "site_setting" WHERE "key" = 'model_studio';
