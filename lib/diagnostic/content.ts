// AI Readiness Assessment — diagnostic content lives in the DB.
//
// The real practitioner-calibrated content (questions, per-option
// scores, branch wiring, risk flag rules, priority triggers, tier
// boundaries, domain weights) is stored as a single JSONB row in
// site_setting keyed 'diagnostic_content' and edited via
// /admin/diagnostic.
//
// New code should call `getDiagnosticContent()` from
// lib/diagnostic/content-config.ts. That loader throws if the row is
// missing or malformed — there is no runtime fallback.
//
// The admin UI uses `DIAGNOSTIC_CONTENT_STARTER` from
// lib/diagnostic/content-config-shared.ts to pre-populate the form on
// first load. That starter is UI-only and never served at runtime.
