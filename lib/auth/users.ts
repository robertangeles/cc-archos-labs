import "server-only";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { authEvent, oauthAccount, userSession, users } from "../db/schema";
import { revokeAllSessionsForUser } from "./session";
import { logAuthEvent } from "./audit";

// Service layer for the admin Users & Roles UI. Owns the queries +
// guard logic that the route handlers wrap.
//
// Guard rails (defense in depth — route handlers also check):
//   - changeRole and setActive cannot demote/deactivate the LAST admin
//     in the system. Returns ERR_LAST_ADMIN.
//   - Admins cannot deactivate themselves. Returns ERR_SELF_DEACTIVATE.
//   - Admins cannot demote themselves if they are the last admin.
//     Returns ERR_LAST_ADMIN (same).

export interface UserListRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  hasPasswordHash: boolean;
  linkedProviders: string[];
}

export interface ListUsersOpts {
  page?: number;
  pageSize?: number;
  /** 'all' | 'admin' | 'member' */
  roleFilter?: "all" | "admin" | "member";
  /** 'all' | 'active' | 'inactive' */
  activeFilter?: "all" | "active" | "inactive";
  /** Free-text search on email + display_name. Case-insensitive. */
  search?: string;
}

export interface ListUsersResult {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listUsers(
  opts: ListUsersOpts = {},
): Promise<ListUsersResult> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));

  const conditions = [];
  if (opts.roleFilter === "admin") conditions.push(eq(users.role, "admin"));
  if (opts.roleFilter === "member") conditions.push(eq(users.role, "member"));
  if (opts.activeFilter === "active") conditions.push(eq(users.isActive, true));
  if (opts.activeFilter === "inactive")
    conditions.push(eq(users.isActive, false));
  if (opts.search && opts.search.trim().length > 0) {
    const term = `%${opts.search.trim()}%`;
    conditions.push(
      or(ilike(users.email, term), ilike(users.displayName, term))!,
    );
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ n: count() })
    .from(users)
    .where(whereClause);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      hasPasswordHash:
        sql<boolean>`${users.passwordHash} IS NOT NULL`.as("has_password_hash"),
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Fetch oauth_account.provider for the rows we're returning in one
  // query. Cheap join — small N. Keeps the row shape stable in tests.
  const userIds = rows.map((r) => r.id);
  const links =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: oauthAccount.userId,
            provider: oauthAccount.provider,
          })
          .from(oauthAccount)
          .where(
            sql`${oauthAccount.userId} IN ${userIds}`,
          );

  const linksByUser = new Map<string, string[]>();
  for (const l of links) {
    if (!linksByUser.has(l.userId)) linksByUser.set(l.userId, []);
    linksByUser.get(l.userId)!.push(l.provider);
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      linkedProviders: linksByUser.get(r.id) ?? [],
    })),
    total: countRow.n,
    page,
    pageSize,
  };
}

export interface UserDetail extends UserListRow {
  recentEvents: Array<{
    id: string;
    eventType: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }>;
  activeSessions: Array<{
    id: string;
    lastSeenAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  }>;
}

export async function getUserDetail(
  userId: string,
): Promise<UserDetail | null> {
  const db = getDb();
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      emailVerifiedAt: users.emailVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      hasPasswordHash:
        sql<boolean>`${users.passwordHash} IS NOT NULL`.as("has_password_hash"),
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRows.length === 0) return null;
  const u = userRows[0];

  const [linkRows, eventRows, sessionRows] = await Promise.all([
    db
      .select({ provider: oauthAccount.provider })
      .from(oauthAccount)
      .where(eq(oauthAccount.userId, userId)),
    db
      .select({
        id: authEvent.id,
        eventType: authEvent.eventType,
        ipAddress: authEvent.ipAddress,
        userAgent: authEvent.userAgent,
        metadata: authEvent.metadata,
        createdAt: authEvent.createdAt,
      })
      .from(authEvent)
      .where(eq(authEvent.userId, userId))
      .orderBy(desc(authEvent.createdAt))
      .limit(50),
    db
      .select({
        id: userSession.id,
        lastSeenAt: userSession.lastSeenAt,
        ipAddress: userSession.ipAddress,
        userAgent: userSession.userAgent,
        createdAt: userSession.createdAt,
      })
      .from(userSession)
      .where(
        and(eq(userSession.userId, userId), sql`${userSession.revokedAt} IS NULL`),
      )
      .orderBy(desc(userSession.lastSeenAt))
      .limit(20),
  ]);

  return {
    ...u,
    linkedProviders: linkRows.map((r) => r.provider),
    recentEvents: eventRows.map((e) => ({
      ...e,
      metadata: (e.metadata as Record<string, unknown>) ?? {},
    })),
    activeSessions: sessionRows,
  };
}

// ============================================================================
// Mutations — protected by guard rails
// ============================================================================

export type MutationError =
  | "ERR_NOT_FOUND"
  | "ERR_LAST_ADMIN"
  | "ERR_SELF_DEACTIVATE"
  | "ERR_INVALID_ROLE"
  | "ERR_NO_CHANGE";

export interface MutationResult {
  ok: boolean;
  error?: MutationError;
}

/**
 * Count admins where is_active=true. Used by the guard rails to refuse
 * the last-admin demote / deactivate. Cheap query — covered by the
 * users_role_active_idx partial index.
 */
async function countActiveAdmins(): Promise<number> {
  const db = getDb();
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  return r.n;
}

/**
 * Change a user's role. Records an auth_event{role_changed} on success.
 * Calls revokeAllSessionsForUser so the affected user signs in fresh
 * with the new role's permissions.
 */
export async function changeRole(opts: {
  actorUserId: string;
  targetUserId: string;
  newRole: "admin" | "member";
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<MutationResult> {
  if (opts.newRole !== "admin" && opts.newRole !== "member") {
    return { ok: false, error: "ERR_INVALID_ROLE" };
  }
  const db = getDb();
  const targetRows = await db
    .select({
      id: users.id,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, opts.targetUserId))
    .limit(1);

  if (targetRows.length === 0) return { ok: false, error: "ERR_NOT_FOUND" };
  const target = targetRows[0];

  if (target.role === opts.newRole) return { ok: false, error: "ERR_NO_CHANGE" };

  // Demoting an admin: refuse if this is the last active admin.
  if (target.role === "admin" && opts.newRole !== "admin") {
    const active = await countActiveAdmins();
    if (active <= 1) return { ok: false, error: "ERR_LAST_ADMIN" };
  }

  await db
    .update(users)
    .set({ role: opts.newRole, updatedAt: new Date() })
    .where(eq(users.id, opts.targetUserId));

  await revokeAllSessionsForUser(opts.targetUserId);

  await logAuthEvent({
    userId: opts.targetUserId,
    eventType: "role_changed",
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
    metadata: {
      from_role: target.role,
      to_role: opts.newRole,
      changed_by_user_id: opts.actorUserId,
    },
  });

  return { ok: true };
}

/**
 * Activate or deactivate a user. Refuses self-deactivation and refuses
 * deactivating the last active admin. Records auth_event on success.
 * Calls revokeAllSessionsForUser on deactivation so existing sessions
 * are killed immediately.
 */
export async function setActive(opts: {
  actorUserId: string;
  targetUserId: string;
  active: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<MutationResult> {
  if (opts.actorUserId === opts.targetUserId && !opts.active) {
    return { ok: false, error: "ERR_SELF_DEACTIVATE" };
  }
  const db = getDb();
  const targetRows = await db
    .select({
      id: users.id,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, opts.targetUserId))
    .limit(1);

  if (targetRows.length === 0) return { ok: false, error: "ERR_NOT_FOUND" };
  const target = targetRows[0];
  if (target.isActive === opts.active) {
    return { ok: false, error: "ERR_NO_CHANGE" };
  }

  // Deactivating an admin: refuse if this is the last active admin.
  if (!opts.active && target.role === "admin") {
    const active = await countActiveAdmins();
    if (active <= 1) return { ok: false, error: "ERR_LAST_ADMIN" };
  }

  await db
    .update(users)
    .set({ isActive: opts.active, updatedAt: new Date() })
    .where(eq(users.id, opts.targetUserId));

  if (!opts.active) {
    await revokeAllSessionsForUser(opts.targetUserId);
  }

  await logAuthEvent({
    userId: opts.targetUserId,
    eventType: opts.active ? "user_reactivated" : "user_deactivated",
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
    metadata: { changed_by_user_id: opts.actorUserId },
  });

  return { ok: true };
}
