import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { assessmentSession } from "../db/schema";

// Privacy retention: assessment_session.ip_address + .user_agent are kept
// for 30 days after the session is created, then nulled out. The session
// row itself + answers + score + report stay — only the request-metadata
// fields are bound to the 30-day window.
//
// 30 is coupled to the /privacy page text ("Server logs: 30 days, then
// purged"). Changing it requires updating both. Hardcoded as a constant
// rather than a Settings row so admin can't silently drift from the
// published policy.

export const SESSION_METADATA_RETENTION_DAYS = 30;

export interface PurgeSessionMetadataResult {
  rowsAffected: number;
  cutoffAt: string;
}

// Nulls ip_address + user_agent on every assessment_session row older
// than the retention window. Idempotent — rows already nulled are
// skipped by the WHERE clause.
//
// Uses created_at (not started_at) for the cutoff: both default to
// now() and are equivalent for our purposes, but created_at is the
// CLAUDE.md-mandated audit timestamp present on every table.
//
// `now` is injected so tests can pin the clock. Defaults to real now.
export async function purgeOldSessionMetadata(input?: {
  now?: Date;
}): Promise<PurgeSessionMetadataResult> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - SESSION_METADATA_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE ${assessmentSession}
    SET ip_address = NULL,
        user_agent = NULL,
        updated_at = ${now}
    WHERE (ip_address IS NOT NULL OR user_agent IS NOT NULL)
      AND created_at < ${cutoff}
  `);

  // postgres.js returns the affected count on the result object's `count`
  // property (Drizzle re-exposes it via the same shape).
  const rowsAffected =
    typeof (result as { count?: number }).count === "number"
      ? (result as { count: number }).count
      : 0;

  return { rowsAffected, cutoffAt: cutoff.toISOString() };
}
