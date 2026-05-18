import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  assessmentSession,
  lead,
  magicLinkToken,
  reportOutput,
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
//   1. delete the lead's sessions (cascades report_output + share_token)
//   2. delete the lead itself (cascades magic_link_token)

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

  // Single transaction so a mid-flight failure leaves the DB consistent.
  // Multi-step delete is required because lead_id is SET NULL on session,
  // not CASCADE — see the schema comment at the top of this file.
  const result = await db.transaction(async (tx) => {
    // Identify the inactive leads in a CTE-friendly subquery. A lead is
    // inactive if every signal we track predates the cutoff. NOT EXISTS
    // semantics treat "no sessions at all" + "no magic links at all" as
    // satisfied — i.e. a registered lead who never re-engaged is eligible
    // for purge 24 months after registration.
    const inactiveLeadIds = sql`
      SELECT ${lead.id} FROM ${lead}
      WHERE ${lead.updatedAt} < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM ${assessmentSession}
          WHERE ${assessmentSession.leadId} = ${lead.id}
            AND ${assessmentSession.createdAt} >= ${cutoff}
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${magicLinkToken}
          WHERE ${magicLinkToken.leadId} = ${lead.id}
            AND ${magicLinkToken.consumedAt} IS NOT NULL
            AND ${magicLinkToken.consumedAt} >= ${cutoff}
        )
    `;

    // Step 1: delete sessions belonging to these leads. Cascades take
    // care of report_output + share_token. We RETURNING-count for the
    // result payload.
    const sessionsResult = await tx.execute(sql`
      DELETE FROM ${assessmentSession}
      WHERE ${assessmentSession.leadId} IN (${inactiveLeadIds})
    `);

    // Step 2: delete the leads themselves. Cascades magic_link_token.
    const leadsResult = await tx.execute(sql`
      DELETE FROM ${lead}
      WHERE ${lead.id} IN (${inactiveLeadIds})
    `);

    const sessionsDeleted =
      typeof (sessionsResult as { count?: number }).count === "number"
        ? (sessionsResult as { count: number }).count
        : 0;
    const leadsDeleted =
      typeof (leadsResult as { count?: number }).count === "number"
        ? (leadsResult as { count: number }).count
        : 0;

    return { sessionsDeleted, leadsDeleted };
  });

  return {
    ...result,
    cutoffAt: cutoff.toISOString(),
  };
}

// Imported for typed reference but only used transitively via cascade.
// Keeping the import explicit makes the cascade chain visible in source.
void reportOutput;
