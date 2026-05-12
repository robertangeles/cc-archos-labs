import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { lead } from "./db/schema";
import { getLeadFromCookies } from "./auth-server";

// Lightweight "is this visitor a signed-in lead, and if so, who" helper
// for the site-wide layout. Used by app/layout.tsx to decide whether
// the header shows "Sign in" or "Hi, [first name] · Sign out".
//
// cache() dedupes per request so the layout's call and any descendant
// that also wants the same data share one DB hit.

export interface SignedInLead {
  leadId: string;
  firstName: string;
}

export const getSignedInLead = cache(
  async (): Promise<SignedInLead | null> => {
    const session = await getLeadFromCookies();
    if (!session) return null;

    const db = getDb();
    const rows = await db
      .select({ id: lead.id, firstName: lead.firstName })
      .from(lead)
      .where(eq(lead.id, session.leadId))
      .limit(1);

    if (rows.length === 0) return null;
    return { leadId: rows[0].id, firstName: rows[0].firstName };
  },
);
