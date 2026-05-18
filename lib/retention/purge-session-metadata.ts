import "server-only";
import { and, isNotNull, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { assessmentSession } from "../db/schema";

// Privacy retention: assessment_session.ip_address + .user_agent are kept
// for 30 days after the session is created, then nulled out. The session
// row itself + answers + score + report stay — only the request-metadata
// fields are bound to the 30-day window.
//
// 30 is coupled to the /privacy page text ("Request metadata: cleared
// after 30 days"). Changing it requires updating both. Hardcoded as a
// constant rather than a Settings row so admin can't silently drift from
// the published policy.

export const SESSION_METADATA_RETENTION_DAYS = 30;

export interface PurgeSessionMetadataResult {
  rowsAffected: number;
  cutoffAt: string;
}

// Nulls ip_address + user_agent on every assessment_session row older
// than the retention window. Idempotent — rows already nulled are
// skipped by the WHERE clause.
//
// Uses Drizzle's typed query builder rather than the raw `sql` template:
// the postgres.js driver rejects Date objects passed through the raw
// template (ERR_INVALID_ARG_TYPE in Function.str), but the typed builder
// converts Date → ISO string via Drizzle's type system before binding.
// See wiki/lessons-learned/2026-05-18-drizzle-raw-sql-rejects-date-params.md.
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
  const updated = await db
    .update(assessmentSession)
    .set({
      ipAddress: null,
      userAgent: null,
      updatedAt: now,
    })
    .where(
      and(
        or(
          isNotNull(assessmentSession.ipAddress),
          isNotNull(assessmentSession.userAgent),
        ),
        lt(assessmentSession.createdAt, cutoff),
      ),
    )
    .returning({ id: assessmentSession.id });

  return {
    rowsAffected: updated.length,
    cutoffAt: cutoff.toISOString(),
  };
}
