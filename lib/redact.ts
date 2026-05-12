// PII redaction helpers for structured logs (D8b). Logs run through Render
// (90-day retention) and any downstream aggregator we add later, so raw
// email + reason text never appear there. The DB still holds the full
// data — debug investigations join DB → log by the deterministic hash.
//
// Design contract:
//   - Deterministic: same input always yields same hash → traceable across
//     logs without revealing the value.
//   - Domain-preserving for emails: keeps the @domain.tld so we can
//     compute lead-source breakdowns without de-anonymising prospects.
//   - Length-preserving for reasons: tells investigators "this is a 12-char
//     short reason" vs "this is a 2000-char essay" without the content.
//   - Hash is sha256 truncated to 8 hex chars (32 bits of entropy). That's
//     enough to distinguish ~65k distinct values before collisions become
//     likely — fine for our daily booking volume; if we ever care about
//     uniqueness at scale, widen the truncation here in one place.

import { createHash } from "node:crypto";

// Short hex digest — used as the discriminator on both email and reason
// redactions. Internal helper exposed for tests.
export function sha8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

// Redact an email for log output. The local part is replaced with the
// hash; the domain is preserved. Reversible only via DB lookup.
//
// Examples:
//   redactEmail("jane.doe@example.com")   → "a1b2c3d4@example.com"
//   redactEmail("rob@archoslabs.xyz")     → "f0e9d8c7@archoslabs.xyz"
//
// If the input has no '@' (malformed), the entire string is hashed and
// no domain is appended — never log raw "malformed" input.
export function redactEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return sha8(email);
  const domain = email.slice(at + 1);
  return `${sha8(email)}@${domain}`;
}

// Redact a free-text "reason" field for log output. Returns a structured
// shape so logs can filter by length bucket without scanning content.
//
// Example:
//   redactReason("I need help with...")
//     → { length: 18, sha8: "e3b0c442" }
//
// The sha8 lets investigators correlate two log lines mentioning the
// same reason (e.g. "claude.call" + "booking.created" for the same row)
// without ever logging the words.
export function redactReason(
  reason: string,
): { length: number; sha8: string } {
  return { length: reason.length, sha8: sha8(reason) };
}
