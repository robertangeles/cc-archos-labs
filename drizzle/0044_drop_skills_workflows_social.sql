-- safety: verified against origin/main on 2026-11-02 by Rob Angeles
--
-- Migration 0044: drop the Skills builder, Workflows and Social posts tables
--
-- Hand-written, matching the convention since 0031. Applied via
-- scripts/db-apply.mjs. DESTRUCTIVE: 14 DROP TABLE. Idempotent (IF EXISTS).
-- Take a pg_dump first; the data is not recoverable from the app afterwards.
-- Run it on PROD only AFTER the code that stops using these tables has deployed:
-- the previous release still reads and writes them.
--
--
-- WHY
--
-- Rob removed the Skills builder, Workflows and Social posts from the Metis
-- workspace ("we will never use them again"). The code, routes, pages and the
-- social publishing cron went in the same change. These tables have no reader
-- left.
--
--
-- WHAT STAYS
--
-- `skill` itself. The news draft pipeline loads its prompts from it
-- (lib/news-radar/draft/skills.ts), so dropping it would stop the live
-- pipeline. Only the Skills builder's child tables go: skill_input,
-- skill_output, skill_version, skill_execution. `skill` keeps its columns.
--
--
-- ORDER
--
-- Children before parents, and no CASCADE, so an unexpected dependent makes the
-- migration fail instead of silently dropping something else. Every foreign key
-- that points at these tables was listed from pg_constraint on DEV first; all of
-- them sit inside this set:
--
--   skill_input, skill_output, skill_version, skill_execution  -> skill (kept)
--   workflow_step -> workflow, skill (kept)
--   workflow_execution_log -> workflow_execution_run, workflow
--   workflow_field, workflow_exec_token, workflow_pending_approval,
--     workflow_execution_run -> workflow
--   publish_log -> social_account
--
-- Dropping a table drops its own indexes and its outgoing foreign keys.
--
--
-- DATA LOST
--
-- Skills builder child rows (input/output definitions, version snapshots, run
-- records), all workflows and their run history, every connected social account
-- (encrypted OAuth tokens), every scheduled and published social post and the
-- publish log. The news draft pipeline's own tables are untouched.

DROP TABLE IF EXISTS "skill_execution";--> statement-breakpoint
DROP TABLE IF EXISTS "skill_input";--> statement-breakpoint
DROP TABLE IF EXISTS "skill_output";--> statement-breakpoint
DROP TABLE IF EXISTS "skill_version";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_execution_log";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_exec_token";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_pending_approval";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_field";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_step";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_execution_run";--> statement-breakpoint
DROP TABLE IF EXISTS "workflow";--> statement-breakpoint
DROP TABLE IF EXISTS "publish_log";--> statement-breakpoint
DROP TABLE IF EXISTS "scheduled_social_post";--> statement-breakpoint
DROP TABLE IF EXISTS "social_account";
