import "server-only";
import { getDb } from "../db";
import { authEvent } from "../db/schema";

// Append-only auth audit log writer. Every auth-relevant action goes
// through this single function. NEVER throws — audit write failure
// must not block the auth flow it's recording, otherwise a DB hiccup
// becomes a denial-of-service on login.
//
// event_type values (v1 — see schema.ts auth_event comment for the
// full list). Use the AuthEventType union below for type safety at
// call sites; the column is plain text so future values land without
// a migration.

export type AuthEventType =
  | "register"
  | "login_password"
  | "login_oauth"
  | "login_magic"
  | "login_failed"
  | "login_session_upgraded"
  | "logout"
  | "password_reset_requested"
  | "password_changed"
  | "email_change_requested"
  | "email_changed"
  | "role_changed"
  | "oauth_linked"
  | "oauth_unlinked"
  | "user_deactivated"
  | "user_reactivated"
  | "session_revoked";

export interface LogAuthEventInput {
  /** FK to users.id. Null for failed-login rows where the email
   *  didn't match any user — preserves the audit trail without
   *  leaking via FK existence. */
  userId: string | null;
  eventType: AuthEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Event-specific JSONB payload. See schema.ts auth_event comment
   *  for the documented per-event shape. */
  metadata?: Record<string, unknown>;
}

/**
 * Write one row to auth_event. Returns void; failures are swallowed
 * and logged to stderr. This is deliberate: the auth flow that
 * triggered the audit is the source of truth — the audit row is a
 * forensic trail, NOT a precondition for letting the flow continue.
 */
export async function logAuthEvent(input: LogAuthEventInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(authEvent).values({
      userId: input.userId,
      eventType: input.eventType,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Log to stderr — Render's log viewer captures it. Don't expose
    // any audit-payload detail to the caller's response.
    console.error(
      `[auth/audit] logAuthEvent failed for ${input.eventType}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
