import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { organisation, organisationMember, users } from "../db/schema";
import type { OrgRole } from "../auth/org-context";

// ============================================================================
// Organisation service — CRUD + membership + invite keys.
// All access control happens in the route via lib/auth/org-context.ts; this
// layer is pure data access (CLAUDE.md: no business logic in routes).
// ============================================================================

/** Invite key: 20 random bytes hex = 40 chars, ~160 bits. Unguessable. */
function generateJoinKey(): string {
  return randomBytes(20).toString("hex");
}

/** Slug base from a name: lowercase, alnum + dashes, trimmed. */
function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "org";
}

/** Find a slug not already taken (append short random suffix on collision). */
async function uniqueSlug(db: DB, base: string): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 5; i++) {
    const existing = await db
      .select({ id: organisation.id })
      .from(organisation)
      .where(eq(organisation.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
    candidate = `${base}-${randomBytes(3).toString("hex")}`;
  }
  // Extremely unlikely; fall back to a fully random slug.
  return `org-${randomBytes(6).toString("hex")}`;
}

/**
 * Create a user's default organisation (idempotent). Returns the org id.
 * Shared by the signup flow AND the historical-user backfill — if the user
 * already owns an org, returns it instead of creating a duplicate.
 */
export async function createDefaultOrgForUser(
  userId: string,
  displayName: string | null,
  dbArg?: DB,
): Promise<string> {
  const db = dbArg ?? getDb();

  const existing = await db
    .select({ id: organisation.id })
    .from(organisation)
    .where(eq(organisation.ownerId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const label = (displayName ?? "").trim() || "My";
  const name = `${label}'s Organisation`.slice(0, 255);
  const slug = await uniqueSlug(db, slugify(label));

  const [org] = await db
    .insert(organisation)
    .values({ name, slug, joinKey: generateJoinKey(), ownerId: userId })
    .returning({ id: organisation.id });

  await db
    .insert(organisationMember)
    .values({ organisationId: org.id, userId, role: "owner" })
    .onConflictDoNothing();

  return org.id;
}

/** Create a brand-new org owned by the user (returns the full row). */
export async function createOrg(
  userId: string,
  input: { name: string; description?: string | null },
) {
  const db = getDb();
  const slug = await uniqueSlug(db, slugify(input.name));
  const [org] = await db
    .insert(organisation)
    .values({
      name: input.name.slice(0, 255),
      description: input.description ?? null,
      slug,
      joinKey: generateJoinKey(),
      ownerId: userId,
    })
    .returning();
  await db
    .insert(organisationMember)
    .values({ organisationId: org.id, userId, role: "owner" })
    .onConflictDoNothing();
  return org;
}

/** Orgs the user belongs to (for the org switcher). */
export async function listUserOrgs(userId: string) {
  const db = getDb();
  return db
    .select({
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      role: organisationMember.role,
    })
    .from(organisationMember)
    .innerJoin(
      organisation,
      eq(organisationMember.organisationId, organisation.id),
    )
    .where(eq(organisationMember.userId, userId))
    .orderBy(desc(organisation.createdAt));
}

/** Org detail + members. joinKey only returned to owner/admin (route decides). */
export async function getOrgWithMembers(orgId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      description: organisation.description,
      logoUrl: organisation.logoUrl,
      joinKey: organisation.joinKey,
      ownerId: organisation.ownerId,
      createdAt: organisation.createdAt,
    })
    .from(organisation)
    .where(eq(organisation.id, orgId))
    .limit(1);
  if (rows.length === 0) return null;

  const members = await db
    .select({
      id: organisationMember.id,
      userId: organisationMember.userId,
      role: organisationMember.role,
      displayName: users.displayName,
      email: users.email,
      joinedAt: organisationMember.createdAt,
    })
    .from(organisationMember)
    .innerJoin(users, eq(organisationMember.userId, users.id))
    .where(eq(organisationMember.organisationId, orgId))
    .orderBy(desc(organisationMember.createdAt));

  return { ...rows[0], members };
}

export async function updateOrg(
  orgId: string,
  input: { name?: string; description?: string | null; logoUrl?: string | null },
) {
  const db = getDb();
  const [updated] = await db
    .update(organisation)
    .set({
      ...(input.name !== undefined ? { name: input.name.slice(0, 255) } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(organisation.id, orgId))
    .returning();
  return updated ?? null;
}

export async function deleteOrg(orgId: string): Promise<void> {
  const db = getDb();
  // FK cascades remove members/clients/projects/kanban. Owner-only (route).
  await db.delete(organisation).where(eq(organisation.id, orgId));
}

export async function regenerateJoinKey(orgId: string): Promise<string> {
  const db = getDb();
  const joinKey = generateJoinKey();
  await db
    .update(organisation)
    .set({ joinKey, updatedAt: sql`now()` })
    .where(eq(organisation.id, orgId));
  return joinKey;
}

/**
 * Join an org by invite key. Idempotent: returns "already_member" if the user
 * is already in the org. Returns "not_found" for a bad/regenerated key.
 */
export async function joinOrgByKey(
  userId: string,
  joinKey: string,
): Promise<{ status: "joined" | "already_member" | "not_found"; orgId?: string }> {
  const db = getDb();
  const orgs = await db
    .select({ id: organisation.id })
    .from(organisation)
    .where(eq(organisation.joinKey, joinKey))
    .limit(1);
  if (orgs.length === 0) return { status: "not_found" };

  const orgId = orgs[0].id;
  const existing = await db
    .select({ id: organisationMember.id })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, orgId),
        eq(organisationMember.userId, userId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { status: "already_member", orgId };

  await db
    .insert(organisationMember)
    .values({ organisationId: orgId, userId, role: "member" })
    .onConflictDoNothing();
  return { status: "joined", orgId };
}

export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: OrgRole,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(organisationMember)
    .set({ role, updatedAt: sql`now()` })
    .where(
      and(
        eq(organisationMember.id, memberId),
        eq(organisationMember.organisationId, orgId),
      ),
    )
    .returning({ id: organisationMember.id });
  return updated.length > 0;
}

/** Remove a member. Refuses to remove the org owner (route enforces too). */
export async function removeMember(
  orgId: string,
  memberId: string,
): Promise<boolean> {
  const db = getDb();
  const removed = await db
    .delete(organisationMember)
    .where(
      and(
        eq(organisationMember.id, memberId),
        eq(organisationMember.organisationId, orgId),
      ),
    )
    .returning({ id: organisationMember.id });
  return removed.length > 0;
}

/** Count owners in an org (used to block removing/demoting the last owner). */
export async function countOwners(orgId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: organisationMember.id })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, orgId),
        eq(organisationMember.role, "owner"),
      ),
    );
  return rows.length;
}
