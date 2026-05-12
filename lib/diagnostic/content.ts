// AI Readiness Assessment — diagnostic content lives in the DB.
//
// The real practitioner-calibrated content (questions, per-option
// scores, branch wiring, risk flag rules, priority triggers, tier
// boundaries, domain weights) is stored as a single JSONB row in
// site_setting keyed 'diagnostic_content' and edited via /admin/diagnostic.
//
// Source ships only a placeholder fallback in
// lib/diagnostic/content-config-shared.ts (DIAGNOSTIC_CONTENT_FALLBACK)
// so the app boots on a fresh clone — but the assessment will look
// broken until the admin row is seeded. See CONTRIBUTING.md → "First-
// deploy admin seeding".
//
// This file remains as a single re-export of the fallback constant for
// any caller (today: tests, tooling) that wants the placeholder shape
// without hitting the DB. New code should call `getDiagnosticContent()`
// from lib/diagnostic/content-config.ts instead.

export { DIAGNOSTIC_CONTENT_FALLBACK as CONTENT_FALLBACK } from "./content-config-shared";
