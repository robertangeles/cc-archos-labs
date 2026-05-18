import "server-only";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notExists,
} from "drizzle-orm";
import { getDb } from "../db";
import {
  assessmentSession,
  lead,
  magicLinkToken,
} from "../db/schema";

// Privacy retention: lead accounts and their assessment data are kept for
// 24 months after the lead's last activity, then deleted entirely. Last
// activity = most recent of:
//   - lead.updated_at
//   - assessment_session.created_at for any session linked to this lead
//   - magic_link_token.consumed_at for any successful sign-in by this lead
//
// 24 months is coupled to the /privacy page text. Changing it requires
// updating both. Hardcoded for the same reason as the 30-day session
// metadata constant: admin must not be able to silently drift from the
// published policy.
//
// Schema note: assessment_session.lead_id is ON DELETE SET NULL (sessions
// can begin anonymously before registration; the FK is nullable by
// design). That means deleting a lead does NOT cascade-delete their
// sessions — it would leave orphan rows. For retention we want the data
// gone, not anonymised. So the purge runs in explicit steps inside a
// transaction:
//   1. find inactive lead ids
//   2. delete those leads' sessions (cascades report_output + share_token)
//   3. delete the leads themselves (cascades magic_link_token)
//
// All three queries use Drizzle's typed builder rather than raw SQL
// templates — postgres.js rejects Date objects passed through the raw
// `sql` tag, but the typed builder serialises them correctly. See
// wiki/lessons-learned/2026-05-18-drizzle-raw-sql-rejects-date-params.md.

export const LEAD_INACTIVITY_RETENTION_MONTHS = 24;

export interface PurgeInactiveLeadsResult {
  leadsDeleted: number;
  sessionsDeleted: number;
  cutoffAt: string;
}

// Deletes every lead whose last activity predates the retention window,
// plus all of their assessment sessions (which cascade to reports +
// share tokens) and magic-link tokens.
//
// `now` is injected so tests can pin the clock. Defaults to real now.
export async function purgeInactiveLeads(input?: {
  now?: Date;
}): Promise<PurgeInactiveLeadsResult> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(
    now.getTime() -
      LEAD_INACTIVITY_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000,
  );

  const db = getDb();

  return await db.transaction(async (tx) => {
    // Step 1: identify inactive leads. NOT EXISTS semantics treat "no
    // sessions at all" + "no consumed magic links at all" as satisfied
    // — i.e. a registered lead who never re-engaged is eligible for
    // purge 24 months after registration.
    const inactiveLeadRows = await tx
      .select({ id: lead.id })
      .from(lead)
      .where(
        and(
          lt(lead.updatedAt, cutoff),
          notExists(
            tx
              .select({ one: assessmentSession.id })
              .from(assessmentSession)
              .where(
                and(
                  eq(assessmentSession.leadId, lead.id),
                  gte(assessmentSession.createdAt, cutoff),
                ),
              ),
          ),
          notExists(
            tx
              .select({ one: magicLinkToken.id })
              .from(magicLinkToken)
              .where(
                and(
                  eq(magicLinkToken.leadId, lead.id),
                  isNotNull(magicLinkToken.consumedAt),
                  gte(magicLinkToken.consumedAt, cutoff),
                ),
              ),
          ),
        ),
      );

    if (inactiveLeadRows.length === 0) {
      return {
        sessionsDeleted: 0,
        leadsDeleted: 0,
        cutoffAt: cutoff.toISOString(),
      };
    }

    const inactiveIds = inactiveLeadRows.map((r) => r.id);

    // Step 2: delete their sessions. Cascades take care of report_output
    // and share_token. .returning() gives us a per-row id to count.
    const sessionsDeleted = await tx
      .delete(assessmentSession)
      .where(inArray(assessmentSession.leadId, inactiveIds))
      .returning({ id: assessmentSession.id });

    // Step 3: delete the leads. Cascades magic_link_token.
    const leadsDeleted = await tx
      .delete(lead)
      .where(inArray(lead.id, inactiveIds))
      .returning({ id: lead.id });

    return {
      sessionsDeleted: sessionsDeleted.length,
      leadsDeleted: leadsDeleted.length,
      cutoffAt: cutoff.toISOString(),
    };
  });
}
