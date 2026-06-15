import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  project,
  kanbanCard,
  kanbanCardComment,
  users,
} from "../db/schema";
import type { OrgRole } from "../auth/org-context";

// ============================================================================
// Kanban comments service — comments on a card. The discussion surface.
//
// Like lib/kanban/service.ts, all access control happens in the route; this
// layer is pure data access. Every read/write is org-scoped through the card's
// parent project: a comment is only ever reachable when its card's project's
// organisation_id matches the caller's org. cardProjectInOrg below is the IDOR
// guard — no card id is ever trusted without the org join.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/**
 * Resolve a card's projectId, but only if that project is in the caller's org.
 * Returns null when the card does not exist or belongs to another org. This is
 * the IDOR guard for every comment op addressed by cardId alone. Mirrors the
 * private helper of the same name in lib/kanban/service.ts (kept local here to
 * avoid widening that module's exported surface for an internal guard).
 */
async function cardProjectInOrg(
  db: DB,
  orgId: string,
  cardId: string,
): Promise<string | null> {
  const rows = await db
    .select({ projectId: kanbanCard.projectId })
    .from(kanbanCard)
    .innerJoin(project, eq(kanbanCard.projectId, project.id))
    .where(and(eq(kanbanCard.id, cardId), eq(project.organisationId, orgId)))
    .limit(1);
  return rows.length > 0 ? rows[0].projectId : null;
}

/**
 * List a card's comments, oldest-first, joined to the author's display info.
 * Empty if the card is not in the caller's org. The author join is a LEFT join
 * so a comment whose user was deleted (user_id set null) still appears.
 */
export async function listComments(orgId: string, cardId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return [];

  return db
    .select({
      id: kanbanCardComment.id,
      cardId: kanbanCardComment.cardId,
      userId: kanbanCardComment.userId,
      body: kanbanCardComment.body,
      createdAt: kanbanCardComment.createdAt,
      updatedAt: kanbanCardComment.updatedAt,
      authorName: users.displayName,
      authorEmail: users.email,
    })
    .from(kanbanCardComment)
    .leftJoin(users, eq(kanbanCardComment.userId, users.id))
    .where(eq(kanbanCardComment.cardId, cardId))
    .orderBy(asc(kanbanCardComment.createdAt));
}

/**
 * Create a comment on a card. Verifies the card is in the org. Returns null if
 * the card is not in the org, or if the body is empty after trimming. The
 * returned row carries the author's display info (looked up after insert).
 */
export async function createComment(
  orgId: string,
  cardId: string,
  userId: string | null,
  body: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return null;

  const trimmed = body.trim();
  if (trimmed.length === 0) return null;

  const [inserted] = await db
    .insert(kanbanCardComment)
    .values({ cardId, userId: userId ?? null, body: trimmed })
    .returning({
      id: kanbanCardComment.id,
      cardId: kanbanCardComment.cardId,
      userId: kanbanCardComment.userId,
      body: kanbanCardComment.body,
      createdAt: kanbanCardComment.createdAt,
      updatedAt: kanbanCardComment.updatedAt,
    });

  // Resolve the author's display info so the caller can render it without a
  // second round trip. Null when the comment is anonymous (no user).
  let authorName: string | null = null;
  let authorEmail: string | null = null;
  if (inserted.userId) {
    const [author] = await db
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, inserted.userId))
      .limit(1);
    authorName = author?.displayName ?? null;
    authorEmail = author?.email ?? null;
  }

  return { ...inserted, authorName, authorEmail };
}

/**
 * Delete a comment. Removes it only when its card is in the caller's org AND
 * the caller is either the comment's author or an org owner/admin. Returns true
 * if a row was removed, false on any violation (not found, wrong org, or not
 * permitted). The org + permission check happens BEFORE the delete so a member
 * can never remove another member's comment.
 */
export async function deleteComment(
  orgId: string,
  commentId: string,
  currentUserId: string,
  role: OrgRole,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();

  // Load the comment joined to its card's project, scoped to the org. This is
  // the IDOR guard: a comment in another org resolves to nothing.
  const [row] = await db
    .select({
      id: kanbanCardComment.id,
      authorId: kanbanCardComment.userId,
    })
    .from(kanbanCardComment)
    .innerJoin(kanbanCard, eq(kanbanCardComment.cardId, kanbanCard.id))
    .innerJoin(project, eq(kanbanCard.projectId, project.id))
    .where(
      and(
        eq(kanbanCardComment.id, commentId),
        eq(project.organisationId, orgId),
      ),
    )
    .limit(1);
  if (!row) return false;

  const isAuthor = row.authorId !== null && row.authorId === currentUserId;
  const isAdmin = role === "owner" || role === "admin";
  if (!isAuthor && !isAdmin) return false;

  const removed = await db
    .delete(kanbanCardComment)
    .where(eq(kanbanCardComment.id, commentId))
    .returning({ id: kanbanCardComment.id });
  return removed.length > 0;
}
