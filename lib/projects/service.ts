import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  project,
  projectMember,
  projectActivity,
  client,
  users,
} from "../db/schema";
import type { OrgRole } from "../auth/org-context";
import type { CreateProjectInput, UpdateProjectInput } from "./validation";
import {
  ingestEntity,
  deactivateEntityMemory,
} from "../brain/workspace-ingest";

// Canonical one-line fact for the workspace-memory tier (Phase 1 ingest).
// Structured summary, not the raw row — kept short and deterministic.
export function projectFact(p: {
  name: string;
  status: string | null;
  clientName: string | null;
  description: string | null;
}): string {
  const client = p.clientName ? ` for client ${p.clientName}` : "";
  const status = p.status ? ` (${p.status})` : "";
  const desc = p.description ? `. ${p.description}` : "";
  return `Project "${p.name}"${status}${client}${desc}`;
}

// ============================================================================
// Project service — projects, membership, and the activity feed.
//
// All access control happens in the route via lib/auth/org-context.ts; this
// layer is pure data access (CLAUDE.md: no business logic in routes). Every
// function is org-scoped: a project is only ever reachable when its
// organisation_id matches the caller's org. Functions that operate on a child
// of a project (members, activity) verify the project is in the org FIRST and
// return an empty/false/null result otherwise — never trusting a raw id.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/**
 * Verify a project belongs to an org. Returns the project id when it does, or
 * null otherwise. The single IDOR guard re-used by every child-of-project
 * function so no membership/activity row is ever read or written for a project
 * outside the caller's org.
 */
async function projectInOrg(
  db: DB,
  orgId: string,
  projectId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organisationId, orgId)))
    .limit(1);
  return rows.length > 0 ? rows[0].id : null;
}

// ---- projects --------------------------------------------------------------

/** List all projects in an org, newest first. */
export async function listProjects(orgId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  return db
    .select({
      id: project.id,
      organisationId: project.organisationId,
      clientId: project.clientId,
      clientName: client.name,
      userId: project.userId,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .leftJoin(client, eq(project.clientId, client.id))
    .where(eq(project.organisationId, orgId))
    .orderBy(desc(project.createdAt));
}

/** Fetch one project, scoped to the org. Returns null if not found in the org. */
export async function getProject(orgId: string, projectId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .select({
      id: project.id,
      organisationId: project.organisationId,
      clientId: project.clientId,
      clientName: client.name,
      userId: project.userId,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .leftJoin(client, eq(project.clientId, client.id))
    .where(and(eq(project.id, projectId), eq(project.organisationId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Create a project in an org. `userId` is the creator (nullable on the row). */
export async function createProject(
  orgId: string,
  userId: string | null,
  input: CreateProjectInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .insert(project)
    .values({
      organisationId: orgId,
      userId: userId ?? null,
      clientId: input.clientId ?? null,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "active",
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    })
    .returning({
      id: project.id,
      organisationId: project.organisationId,
      clientId: project.clientId,
      userId: project.userId,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  // Re-read through the join so the response carries clientName.
  const created = await getProject(orgId, row.id, db);
  // Fire-and-forget: remember the new project (flag-gated, fail-soft).
  if (created) {
    void ingestEntity({
      orgId,
      sourceType: "project",
      sourceEntityId: created.id,
      body: projectFact(created),
    });
  }
  return created;
}

/** Update a project, scoped to the org. Returns null if not found in the org. */
export async function updateProject(
  orgId: string,
  projectId: string,
  input: UpdateProjectInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .update(project)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description ?? null }
        : {}),
      ...(input.clientId !== undefined
        ? { clientId: input.clientId ?? null }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined
        ? { startDate: input.startDate ?? null }
        : {}),
      ...(input.endDate !== undefined
        ? { endDate: input.endDate ?? null }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(project.id, projectId), eq(project.organisationId, orgId)))
    .returning({
      id: project.id,
      organisationId: project.organisationId,
      clientId: project.clientId,
      userId: project.userId,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  // Re-read through the join so the response carries clientName.
  const updated = row ? await getProject(orgId, row.id, db) : null;
  // Dirty-check: only re-ingest when a text-bearing field changed (skip
  // no-op churn on e.g. a date-only edit).
  const textChanged =
    input.name !== undefined ||
    input.description !== undefined ||
    input.status !== undefined ||
    input.clientId !== undefined;
  if (updated && textChanged) {
    void ingestEntity({
      orgId,
      sourceType: "project",
      sourceEntityId: updated.id,
      body: projectFact(updated),
    });
  }
  return updated;
}

/** Delete a project, scoped to the org. Returns true if a row was removed. */
export async function deleteProject(
  orgId: string,
  projectId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  // FK cascades remove members, activity, columns, cards, and labels.
  const removed = await db
    .delete(project)
    .where(and(eq(project.id, projectId), eq(project.organisationId, orgId)))
    .returning({ id: project.id });
  if (removed.length > 0) {
    // Fire-and-forget: forget the deleted project's workspace facts.
    void deactivateEntityMemory({
      orgId,
      sourceType: "project",
      sourceEntityId: projectId,
    });
  }
  return removed.length > 0;
}

// ---- project members -------------------------------------------------------

/** List members of a project (with user display info). Empty if not in org. */
export async function listProjectMembers(
  orgId: string,
  projectId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return [];

  return db
    .select({
      id: projectMember.id,
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
      addedAt: projectMember.addedAt,
      displayName: users.displayName,
      email: users.email,
    })
    .from(projectMember)
    .innerJoin(users, eq(projectMember.userId, users.id))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(desc(projectMember.addedAt));
}

/**
 * Add a member to a project. Returns null if the project is not in the org.
 * Idempotent on (project, user): an existing membership is returned unchanged.
 */
export async function addProjectMember(
  orgId: string,
  projectId: string,
  userId: string,
  role: OrgRole,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const [row] = await db
    .insert(projectMember)
    .values({ projectId, userId, role })
    .onConflictDoNothing({
      target: [projectMember.projectId, projectMember.userId],
    })
    .returning({
      id: projectMember.id,
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
      addedAt: projectMember.addedAt,
    });

  // onConflictDoNothing returns nothing when the row already existed; fetch it
  // so the caller always gets the current membership row.
  if (row) return row;
  const [existing] = await db
    .select({
      id: projectMember.id,
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
      addedAt: projectMember.addedAt,
    })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
      ),
    )
    .limit(1);
  return existing ?? null;
}

/** Remove a member from a project. Returns true if a row was removed. */
export async function removeProjectMember(
  orgId: string,
  projectId: string,
  memberId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return false;

  const removed = await db
    .delete(projectMember)
    .where(
      and(
        eq(projectMember.id, memberId),
        eq(projectMember.projectId, projectId),
      ),
    )
    .returning({ id: projectMember.id });
  return removed.length > 0;
}

// ---- activity --------------------------------------------------------------

/** List a project's activity feed, newest first. Empty if not in org. */
export async function listActivity(
  orgId: string,
  projectId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return [];

  return db
    .select({
      id: projectActivity.id,
      projectId: projectActivity.projectId,
      userId: projectActivity.userId,
      action: projectActivity.action,
      entityType: projectActivity.entityType,
      entityId: projectActivity.entityId,
      entityName: projectActivity.entityName,
      createdAt: projectActivity.createdAt,
    })
    .from(projectActivity)
    .where(eq(projectActivity.projectId, projectId))
    .orderBy(desc(projectActivity.createdAt));
}

/** Append an activity row. Returns null if the project is not in the org. */
export async function logActivity(
  orgId: string,
  projectId: string,
  userId: string | null,
  action: string,
  entityType: string | null,
  entityId: string | null,
  entityName: string | null,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const [row] = await db
    .insert(projectActivity)
    .values({
      projectId,
      userId: userId ?? null,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      entityName: entityName ?? null,
    })
    .returning({
      id: projectActivity.id,
      projectId: projectActivity.projectId,
      userId: projectActivity.userId,
      action: projectActivity.action,
      entityType: projectActivity.entityType,
      entityId: projectActivity.entityId,
      entityName: projectActivity.entityName,
      createdAt: projectActivity.createdAt,
    });
  return row;
}
