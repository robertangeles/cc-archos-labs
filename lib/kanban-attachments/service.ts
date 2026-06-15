import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  project,
  kanbanCard,
  kanbanCardAttachment,
} from "../db/schema";

// ============================================================================
// Kanban card attachments service — files attached to a card.
//
// Kept in its own module (lib/kanban-attachments/, NOT lib/kanban/) so it does
// not touch the kanban stream's files. Access control is identical to the rest
// of the kanban layer: every read/write is org-scoped through the card's parent
// project, so an attachment is only ever reachable when its card's project's
// organisation_id matches the caller's org. cardProjectInOrg is the IDOR guard
// — a card id is never trusted without the org join.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/**
 * Resolve a card's projectId, but only if that project is in the caller's org.
 * Returns null when the card does not exist or belongs to another org. This is
 * the IDOR guard for every attachment op addressed by cardId alone.
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
 * List a card's attachments, oldest-first. Empty if the card is not in the
 * caller's org.
 */
export async function listAttachments(
  orgId: string,
  cardId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return [];

  return db
    .select({
      id: kanbanCardAttachment.id,
      cardId: kanbanCardAttachment.cardId,
      fileName: kanbanCardAttachment.fileName,
      fileUrl: kanbanCardAttachment.fileUrl,
      fileType: kanbanCardAttachment.fileType,
      fileSize: kanbanCardAttachment.fileSize,
      uploadedBy: kanbanCardAttachment.uploadedBy,
      createdAt: kanbanCardAttachment.createdAt,
    })
    .from(kanbanCardAttachment)
    .where(eq(kanbanCardAttachment.cardId, cardId))
    .orderBy(asc(kanbanCardAttachment.createdAt));
}

/**
 * Create an attachment row for a card. Verifies the card is in the org first.
 * Returns null if the card is not in the caller's org. The file itself is
 * uploaded to Cloudinary by the route before this is called; this records the
 * resulting metadata.
 */
export async function createAttachment(
  orgId: string,
  cardId: string,
  meta: {
    fileName: string;
    fileUrl: string;
    fileType: string | null;
    fileSize: number | null;
  },
  uploadedBy: string | null,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return null;

  const [inserted] = await db
    .insert(kanbanCardAttachment)
    .values({
      cardId,
      fileName: meta.fileName,
      fileUrl: meta.fileUrl,
      fileType: meta.fileType,
      fileSize: meta.fileSize,
      uploadedBy,
    })
    .returning({
      id: kanbanCardAttachment.id,
      cardId: kanbanCardAttachment.cardId,
      fileName: kanbanCardAttachment.fileName,
      fileUrl: kanbanCardAttachment.fileUrl,
      fileType: kanbanCardAttachment.fileType,
      fileSize: kanbanCardAttachment.fileSize,
      uploadedBy: kanbanCardAttachment.uploadedBy,
      createdAt: kanbanCardAttachment.createdAt,
    });

  return inserted;
}

/**
 * Delete an attachment. Removes it only when its card is in the caller's org.
 * Returns true if a row was removed, false on any violation (not found, wrong
 * org). The org check happens via a join BEFORE the delete so an attachment in
 * another org can never be removed.
 */
export async function deleteAttachment(
  orgId: string,
  attachmentId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();

  // Load the attachment joined to its card's project, scoped to the org. This
  // is the IDOR guard: an attachment in another org resolves to nothing.
  const [row] = await db
    .select({ id: kanbanCardAttachment.id })
    .from(kanbanCardAttachment)
    .innerJoin(kanbanCard, eq(kanbanCardAttachment.cardId, kanbanCard.id))
    .innerJoin(project, eq(kanbanCard.projectId, project.id))
    .where(
      and(
        eq(kanbanCardAttachment.id, attachmentId),
        eq(project.organisationId, orgId),
      ),
    )
    .limit(1);
  if (!row) return false;

  const removed = await db
    .delete(kanbanCardAttachment)
    .where(eq(kanbanCardAttachment.id, attachmentId))
    .returning({ id: kanbanCardAttachment.id });
  return removed.length > 0;
}
