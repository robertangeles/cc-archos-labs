import "server-only";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../db";
import { users, userSession } from "../db/schema";
import { signSessionJwt, type SessionJwtPayload } from "./session-jwt";

// Node-only session lifecycle helpers. Owns the `user_session` table +
// the `users.token_version` revocation column. Pairs with
// lib/auth/session-jwt.ts (Edge-safe sign/verify) — this file handles
// every DB-touching step.
//
// Lifecycle (the hybrid JWT + DB model from plan E1):
//
//   sign-in
//     │
//     ▼
//   issueSession(userId, ip, ua)
//     │  inserts user_session row, mints 5-min JWT
//     ▼
//   ┌─────────────────────────────────┐
//   │ proxy.ts: verifySessionJwt only │  Edge gate — signature + exp
//   └─────────────────────────────────┘
//     │  (JWT passes signature check)
//     ▼
//   ┌─────────────────────────────────┐
//   │ route handler:                  │  Node — full liveness check
//   │   loadActiveSession(sessionId)  │
//   └─────────────────────────────────┘
//     │
//     ▼  (returns null if revoked / user_session.expires_at past /
//     │   user.is_active=false / tokenVersion mismatch)
//     ▼
//   refreshSession(sessionId)  ← bumps last_seen_at, mints fresh JWT
//
//   revokeSession(sessionId)
//   revokeAllSessionsForUser(userId)  ← bumps users.token_version
//                                       + stamps revoked_at on all sessions

// 7 days. The session row's hard expiry — independent of the 5-min
// JWT TTL. Activity-based sliding refresh extends this.
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface IssueSessionResult {
  /** The JWT string suitable for setting as the cookie value. */
  cookieValue: string;
  /** The DB row's id (FK target). */
  sessionId: string;
  /** When the cookie should expire (matches user_session.expires_at). */
  expiresAt: Date;
}

export interface LoadedSession {
  user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    tokenVersion: number;
    displayName: string | null;
    emailVerifiedAt: Date | null;
  };
  session: {
    id: string;
    expiresAt: Date;
    lastSeenAt: Date;
    revokedAt: Date | null;
  };
}

/**
 * Insert a new user_session row + mint the 5-min session JWT for it.
 * Call from sign-in flows (password login, magic-link verify, OAuth
 * callback) after the user identity is confirmed.
 *
 * Throws if the userId doesn't exist or is deactivated — callers should
 * verify the user is sign-in-eligible BEFORE calling this.
 */
export async function issueSession(opts: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<IssueSessionResult> {
  const db = getDb();

  // Pull the user's current tokenVersion so the issued JWT carries the
  // live value. Also defensively confirms the user exists + is active.
  const userRow = await db
    .select({
      id: users.id,
      tokenVersion: users.tokenVersion,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1);

  if (userRow.length === 0) {
    throw new Error(`issueSession: user ${opts.userId} not found`);
  }
  if (!userRow[0].isActive) {
    throw new Error(`issueSession: user ${opts.userId} is deactivated`);
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const inserted = await db
    .insert(userSession)
    .values({
      userId: opts.userId,
      expiresAt,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning({ id: userSession.id });

  const sessionId = inserted[0].id;

  const cookieValue = await signSessionJwt({
    userId: opts.userId,
    sessionId,
    tokenVersion: userRow[0].tokenVersion,
  });

  return { cookieValue, sessionId, expiresAt };
}

/**
 * Fetch the user_session row + joined users row for liveness check.
 * Returns null if any of: row missing, revoked, expired, user deactivated,
 * OR the supplied tokenVersion doesn't match the live users.token_version.
 *
 * Called by route handlers after `proxy.ts` lets the request through.
 * The `tokenVersion` arg comes from the verified JWT payload — pass
 * `null` to skip that check (e.g. unauthenticated routes that want to
 * resolve the cookie if present).
 */
export async function loadActiveSession(
  sessionId: string,
  jwtTokenVersion: number | null,
): Promise<LoadedSession | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;

  const db = getDb();
  const rows = await db
    .select({
      sId: userSession.id,
      sExpiresAt: userSession.expiresAt,
      sLastSeenAt: userSession.lastSeenAt,
      sRevokedAt: userSession.revokedAt,
      uId: users.id,
      uEmail: users.email,
      uRole: users.role,
      uIsActive: users.isActive,
      uTokenVersion: users.tokenVersion,
      uDisplayName: users.displayName,
      uEmailVerifiedAt: users.emailVerifiedAt,
    })
    .from(userSession)
    .innerJoin(users, eq(userSession.userId, users.id))
    .where(eq(userSession.id, sessionId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];

  if (r.sRevokedAt !== null) return null;
  if (r.sExpiresAt.getTime() <= Date.now()) return null;
  if (!r.uIsActive) return null;
  if (jwtTokenVersion !== null && r.uTokenVersion !== jwtTokenVersion) {
    return null;
  }

  return {
    user: {
      id: r.uId,
      email: r.uEmail,
      role: r.uRole,
      isActive: r.uIsActive,
      tokenVersion: r.uTokenVersion,
      displayName: r.uDisplayName,
      emailVerifiedAt: r.uEmailVerifiedAt,
    },
    session: {
      id: r.sId,
      expiresAt: r.sExpiresAt,
      lastSeenAt: r.sLastSeenAt,
      revokedAt: r.sRevokedAt,
    },
  };
}

/**
 * Sliding refresh: stamps user_session.last_seen_at = now() AND mints a
 * fresh 5-min JWT carrying the user's current tokenVersion. Call when
 * a verified JWT is about to expire (or on every authenticated request,
 * server-side, if you want activity-based extension).
 *
 * Returns null if the session is no longer loadable (revoked, expired,
 * user deactivated). Caller should clear the cookie on null.
 */
export async function refreshSession(
  sessionId: string,
): Promise<IssueSessionResult | null> {
  const db = getDb();
  const loaded = await loadActiveSession(sessionId, null);
  if (!loaded) return null;

  await db
    .update(userSession)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(userSession.id, sessionId));

  const cookieValue = await signSessionJwt({
    userId: loaded.user.id,
    sessionId,
    tokenVersion: loaded.user.tokenVersion,
  });

  return {
    cookieValue,
    sessionId,
    expiresAt: loaded.session.expiresAt,
  };
}

/**
 * Stamp a single session as revoked. Future loadActiveSession() calls
 * for it return null. Used for explicit sign-out + "revoke this device"
 * UI on /account.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return;
  const db = getDb();
  await db
    .update(userSession)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(userSession.id, sessionId), isNull(userSession.revokedAt)),
    );
}

/**
 * Revoke ALL sessions for a user AND bump users.token_version so any
 * still-valid 5-min JWT in flight fails its next route-handler liveness
 * check via `loadActiveSession(_, jwtTokenVersion)` mismatch. Call on:
 *   - password reset (any flow)
 *   - email change
 *   - role change
 *   - admin force-logout / deactivation
 *
 * Returns the number of session rows newly revoked (for audit logs).
 */
export async function revokeAllSessionsForUser(
  userId: string,
): Promise<number> {
  if (typeof userId !== "string" || userId.length === 0) return 0;
  const db = getDb();

  // Bump tokenVersion. The arithmetic is done in SQL so concurrent
  // bumps (rare: race between two admin actions on the same user) all
  // increment cleanly.
  await db
    .update(users)
    .set({
      tokenVersion: drizzleSql`${users.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const revoked = await db
    .update(userSession)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(userSession.userId, userId), isNull(userSession.revokedAt)),
    )
    .returning({ id: userSession.id });

  return revoked.length;
}

export type { SessionJwtPayload };
