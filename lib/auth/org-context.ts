import "server-only";
import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { organisation, organisationMember } from "../db/schema";
import { getCurrentUser } from "./current-user";
import { assertSameOriginRequest, CsrfOriginError } from "./csrf";
import type { LoadedSession } from "./session";

// ============================================================================
// Org context — the single enforcement point for multi-tenant access.
// ============================================================================
//
//  request ─▶ requireOrgContext(request, {mutation})
//                │  ├─ assertSameOriginRequest   (CSRF, mutations only)
//                │  ├─ getCurrentUser()          (401 if no session)
//                │  └─ resolveOrgContext()       (which org + role HERE)
//                ▼
//          { auth, ctx:{orgId, role} }  ─▶ requireRole(ctx, "owner","admin")
//
// resolveOrgContext re-validates membership server-side on EVERY call, so a
// tampered org cookie can only ever resolve to an org the user is a member of.
// role is read per (user, org) from organisation_member — never users.role.
// ============================================================================

export const ORG_COOKIE = "archos_org";

export type OrgRole = "owner" | "admin" | "member";

export interface OrgContext {
  /** The organisation the request is acting within. */
  orgId: string;
  /** The current user's role IN THAT ORG (per organisation_member). */
  role: OrgRole;
}

// Read-visibility tiers (decision D4). SHARED features are readable by all org
// members; PRIVATE features are owner-only but tagged with the org. These drive
// the Layer-3 org-scoping of existing services (gated by ORG_SCOPING_ENABLED).
export const SHARED_TIER_TABLES = [
  "skill",
  "workflow",
  "social_account",
  "scheduled_social_post",
  "knowledge_document",
] as const;
export const PRIVATE_TIER_TABLES = [
  "conversation",
  "user_brain",
  "user_rule",
] as const;

/**
 * Whether org-scoping of EXISTING workspace features is live. Read per-request
 * at call time (never cached at module load) so a deploy that flips the env var
 * takes effect without a cold start serving the wrong branch. New consulting
 * features (org/clients/projects/kanban) do NOT read this — they are always
 * org-scoped.
 */
export function isOrgScopingEnabled(): boolean {
  return process.env.ORG_SCOPING_ENABLED === "true";
}

/** Typed auth/authorization failures that routes map to HTTP statuses. */
export class OrgAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrgAuthError";
  }
}

/** Thrown by requireRole when the current role is insufficient. */
export class OrgRoleError extends OrgAuthError {
  constructor(allowed: OrgRole[]) {
    super(403, "forbidden", `Requires role: ${allowed.join(" or ")}`);
    this.name = "OrgRoleError";
  }
}

/** Read the current org id from the org cookie (or null). */
export async function getOrgIdFromCookies(): Promise<string | null> {
  const store = await cookies();
  return store.get(ORG_COOKIE)?.value ?? null;
}

/** Set the active org cookie (e.g. on org switch / first login). */
export async function setOrgCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearOrgCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ORG_COOKIE);
}

/**
 * Resolve which org the request acts in, and the user's role there.
 *
 * - requestedOrgId (from cookie) + user is a member → that org, that role.
 * - no/invalid cookie → the user's default org: their OWNED org first, else
 *   their most recent membership. This closes the cutover empty-workspace hole
 *   (a stale or absent cookie never sends the user to an org whose rows were
 *   backfilled under a different default).
 * - authed user with zero orgs → null. Should not happen post-signup (we create
 *   a default org at registration); callers treat null as "no org context".
 */
export async function resolveOrgContext(
  userId: string,
  requestedOrgId?: string | null,
): Promise<OrgContext | null> {
  const db = getDb();

  if (requestedOrgId) {
    const member = await db
      .select({ role: organisationMember.role })
      .from(organisationMember)
      .where(
        and(
          eq(organisationMember.organisationId, requestedOrgId),
          eq(organisationMember.userId, userId),
        ),
      )
      .limit(1);
    if (member.length > 0) {
      return { orgId: requestedOrgId, role: member[0].role as OrgRole };
    }
    // Requested org is not a membership (stale cookie / removed / deleted) —
    // fall through to the user's default org. Never 500, never honour it.
  }

  // Default org: prefer the org the user owns (the backfill/signup default).
  const owned = await db
    .select({ orgId: organisation.id })
    .from(organisation)
    .where(eq(organisation.ownerId, userId))
    .orderBy(desc(organisation.createdAt))
    .limit(1);
  if (owned.length > 0) {
    return { orgId: owned[0].orgId, role: "owner" };
  }

  // Otherwise any membership (most recent).
  const membership = await db
    .select({
      orgId: organisationMember.organisationId,
      role: organisationMember.role,
    })
    .from(organisationMember)
    .where(eq(organisationMember.userId, userId))
    .orderBy(desc(organisationMember.createdAt))
    .limit(1);
  if (membership.length > 0) {
    return { orgId: membership[0].orgId, role: membership[0].role as OrgRole };
  }

  return null;
}

/** Throw OrgRoleError unless the context role is one of `allowed`. */
export function requireRole(ctx: OrgContext, ...allowed: OrgRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new OrgRoleError(allowed);
  }
}

/**
 * The standard route guard. Resolves CSRF (mutations), the current user, and
 * org context in one call. Throws OrgAuthError (mapped to a status by
 * orgAuthErrorResponse) on any failure.
 */
export async function requireOrgContext(
  request: Request,
  opts: { mutation?: boolean } = {},
): Promise<{ auth: LoadedSession; ctx: OrgContext }> {
  if (opts.mutation) {
    try {
      assertSameOriginRequest(request);
    } catch (err) {
      if (err instanceof CsrfOriginError) {
        throw new OrgAuthError(403, "csrf", "Cross-origin request blocked");
      }
      throw err;
    }
  }

  const auth = await getCurrentUser();
  if (!auth) {
    throw new OrgAuthError(401, "unauthenticated", "Authentication required");
  }

  const requestedOrgId = await getOrgIdFromCookies();
  const ctx = await resolveOrgContext(auth.user.id, requestedOrgId);
  if (!ctx) {
    throw new OrgAuthError(403, "no_org", "No organisation context");
  }

  return { auth, ctx };
}

/**
 * Map an OrgAuthError to a JSON Response. Returns null for non-OrgAuthError so
 * callers can rethrow. Plain-language messages only (no raw exceptions).
 */
export function orgAuthErrorResponse(err: unknown): Response | null {
  if (err instanceof OrgAuthError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status });
  }
  return null;
}
