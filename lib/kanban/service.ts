import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  project,
  kanbanColumn,
  kanbanCard,
  cardLabel,
  cardLabelAssignment,
} from "../db/schema";
import type {
  CreateColumnInput,
  UpdateColumnInput,
  CreateCardInput,
  UpdateCardInput,
} from "./validation";

// ============================================================================
// Kanban service — columns, cards, and labels. The board work-surface.
//
// All access control happens in the route via lib/auth/org-context.ts; this
// layer is pure data access. Every read/write is org-scoped through the parent
// project: a column or card is only reachable when its project's
// organisation_id matches the caller's org. The IDOR guards below are the
// single enforcement point — no id is ever trusted without the org join.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/**
 * Verify a project belongs to an org. Returns the project id when it does, or
 * null otherwise. Used by every column/card/label op that is addressed by
 * projectId.
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

/**
 * Resolve a card's projectId, but only if that project is in the caller's org.
 * Returns null when the card does not exist or belongs to another org. This is
 * the IDOR guard for every card op addressed by cardId alone.
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

// ---- columns ---------------------------------------------------------------

/** List a project's columns, ordered by sortOrder. Empty if not in org. */
export async function listColumns(orgId: string, projectId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return [];

  return db
    .select({
      id: kanbanColumn.id,
      projectId: kanbanColumn.projectId,
      name: kanbanColumn.name,
      color: kanbanColumn.color,
      sortOrder: kanbanColumn.sortOrder,
      createdAt: kanbanColumn.createdAt,
      updatedAt: kanbanColumn.updatedAt,
    })
    .from(kanbanColumn)
    .where(eq(kanbanColumn.projectId, projectId))
    .orderBy(asc(kanbanColumn.sortOrder), asc(kanbanColumn.createdAt));
}

/** Create a column in a project. Returns null if the project is not in the org. */
export async function createColumn(
  orgId: string,
  projectId: string,
  input: CreateColumnInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const [row] = await db
    .insert(kanbanColumn)
    .values({
      projectId,
      name: input.name,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({
      id: kanbanColumn.id,
      projectId: kanbanColumn.projectId,
      name: kanbanColumn.name,
      color: kanbanColumn.color,
      sortOrder: kanbanColumn.sortOrder,
      createdAt: kanbanColumn.createdAt,
      updatedAt: kanbanColumn.updatedAt,
    });
  return row;
}

/** Update a column, scoped to a project in the org. Null if not found in org. */
export async function updateColumn(
  orgId: string,
  projectId: string,
  columnId: string,
  input: UpdateColumnInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const [row] = await db
    .update(kanbanColumn)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(kanbanColumn.id, columnId),
        eq(kanbanColumn.projectId, projectId),
      ),
    )
    .returning({
      id: kanbanColumn.id,
      projectId: kanbanColumn.projectId,
      name: kanbanColumn.name,
      color: kanbanColumn.color,
      sortOrder: kanbanColumn.sortOrder,
      createdAt: kanbanColumn.createdAt,
      updatedAt: kanbanColumn.updatedAt,
    });
  return row ?? null;
}

/** Delete a column, scoped to a project in the org. True if a row was removed. */
export async function deleteColumn(
  orgId: string,
  projectId: string,
  columnId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return false;

  // FK cascade removes the column's cards.
  const removed = await db
    .delete(kanbanColumn)
    .where(
      and(
        eq(kanbanColumn.id, columnId),
        eq(kanbanColumn.projectId, projectId),
      ),
    )
    .returning({ id: kanbanColumn.id });
  return removed.length > 0;
}

// ---- board (columns + cards assembled) -------------------------------------

/**
 * The full board: every column (ordered by sortOrder) with its cards (ordered
 * by sortOrder). Fetched in TWO queries — all columns for the project, all
 * cards for the project — then assembled in memory. No N+1. Returns null if
 * the project is not in the org.
 */
export async function getBoard(orgId: string, projectId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const columns = await db
    .select({
      id: kanbanColumn.id,
      projectId: kanbanColumn.projectId,
      name: kanbanColumn.name,
      color: kanbanColumn.color,
      sortOrder: kanbanColumn.sortOrder,
      createdAt: kanbanColumn.createdAt,
      updatedAt: kanbanColumn.updatedAt,
    })
    .from(kanbanColumn)
    .where(eq(kanbanColumn.projectId, projectId))
    .orderBy(asc(kanbanColumn.sortOrder), asc(kanbanColumn.createdAt));

  const cards = await db
    .select({
      id: kanbanCard.id,
      columnId: kanbanCard.columnId,
      projectId: kanbanCard.projectId,
      title: kanbanCard.title,
      description: kanbanCard.description,
      priority: kanbanCard.priority,
      dueDate: kanbanCard.dueDate,
      sortOrder: kanbanCard.sortOrder,
      assigneeId: kanbanCard.assigneeId,
      coverImageUrl: kanbanCard.coverImageUrl,
      artifactType: kanbanCard.artifactType,
      artifactId: kanbanCard.artifactId,
      artifactUrl: kanbanCard.artifactUrl,
      createdAt: kanbanCard.createdAt,
      updatedAt: kanbanCard.updatedAt,
    })
    .from(kanbanCard)
    .where(eq(kanbanCard.projectId, projectId))
    .orderBy(asc(kanbanCard.sortOrder), asc(kanbanCard.createdAt));

  // Bucket cards by columnId in one pass, preserving the sorted order above.
  const cardsByColumn = new Map<string, typeof cards>();
  for (const card of cards) {
    const bucket = cardsByColumn.get(card.columnId);
    if (bucket) bucket.push(card);
    else cardsByColumn.set(card.columnId, [card]);
  }

  return columns.map((column) => ({
    ...column,
    cards: cardsByColumn.get(column.id) ?? [],
  }));
}

// ---- cards -----------------------------------------------------------------

/**
 * Create a card in a column. Returns null if the project is not in the org, or
 * if the target column does not belong to that project.
 */
export async function createCard(
  orgId: string,
  projectId: string,
  columnId: string,
  input: CreateCardInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  // The column must live in this project (prevents cross-project planting).
  const [col] = await db
    .select({ id: kanbanColumn.id })
    .from(kanbanColumn)
    .where(
      and(
        eq(kanbanColumn.id, columnId),
        eq(kanbanColumn.projectId, projectId),
      ),
    )
    .limit(1);
  if (!col) return null;

  const [row] = await db
    .insert(kanbanCard)
    .values({
      columnId,
      projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      dueDate: input.dueDate ?? null,
      sortOrder: input.sortOrder ?? 0,
      assigneeId: input.assigneeId ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
    })
    .returning({
      id: kanbanCard.id,
      columnId: kanbanCard.columnId,
      projectId: kanbanCard.projectId,
      title: kanbanCard.title,
      description: kanbanCard.description,
      priority: kanbanCard.priority,
      dueDate: kanbanCard.dueDate,
      sortOrder: kanbanCard.sortOrder,
      assigneeId: kanbanCard.assigneeId,
      coverImageUrl: kanbanCard.coverImageUrl,
      artifactType: kanbanCard.artifactType,
      artifactId: kanbanCard.artifactId,
      artifactUrl: kanbanCard.artifactUrl,
      createdAt: kanbanCard.createdAt,
      updatedAt: kanbanCard.updatedAt,
    });
  return row;
}

/** Fetch one card, scoped to the org via its project. Null if not in org. */
export async function getCard(orgId: string, cardId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .select({
      id: kanbanCard.id,
      columnId: kanbanCard.columnId,
      projectId: kanbanCard.projectId,
      title: kanbanCard.title,
      description: kanbanCard.description,
      priority: kanbanCard.priority,
      dueDate: kanbanCard.dueDate,
      sortOrder: kanbanCard.sortOrder,
      assigneeId: kanbanCard.assigneeId,
      coverImageUrl: kanbanCard.coverImageUrl,
      artifactType: kanbanCard.artifactType,
      artifactId: kanbanCard.artifactId,
      artifactUrl: kanbanCard.artifactUrl,
      createdAt: kanbanCard.createdAt,
      updatedAt: kanbanCard.updatedAt,
    })
    .from(kanbanCard)
    .innerJoin(project, eq(kanbanCard.projectId, project.id))
    .where(and(eq(kanbanCard.id, cardId), eq(project.organisationId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Update a card, scoped to the org via its project. Null if not in org. */
export async function updateCard(
  orgId: string,
  cardId: string,
  input: UpdateCardInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return null;

  const [row] = await db
    .update(kanbanCard)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description ?? null }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ?? null } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId ?? null }
        : {}),
      ...(input.coverImageUrl !== undefined
        ? { coverImageUrl: input.coverImageUrl ?? null }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(kanbanCard.id, cardId))
    .returning({
      id: kanbanCard.id,
      columnId: kanbanCard.columnId,
      projectId: kanbanCard.projectId,
      title: kanbanCard.title,
      description: kanbanCard.description,
      priority: kanbanCard.priority,
      dueDate: kanbanCard.dueDate,
      sortOrder: kanbanCard.sortOrder,
      assigneeId: kanbanCard.assigneeId,
      coverImageUrl: kanbanCard.coverImageUrl,
      artifactType: kanbanCard.artifactType,
      artifactId: kanbanCard.artifactId,
      artifactUrl: kanbanCard.artifactUrl,
      createdAt: kanbanCard.createdAt,
      updatedAt: kanbanCard.updatedAt,
    });
  return row ?? null;
}

/** Delete a card, scoped to the org via its project. True if a row was removed. */
export async function deleteCard(
  orgId: string,
  cardId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return false;

  const removed = await db
    .delete(kanbanCard)
    .where(eq(kanbanCard.id, cardId))
    .returning({ id: kanbanCard.id });
  return removed.length > 0;
}

/**
 * Move a card to a column + sort position. Verifies the card's project is in
 * the org AND that the target column belongs to that SAME project (no
 * cross-project or cross-org moves). Returns null on any violation.
 */
export async function moveCard(
  orgId: string,
  cardId: string,
  toColumnId: string,
  toSortOrder: number,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const projectId = await cardProjectInOrg(db, orgId, cardId);
  if (!projectId) return null;

  // Target column must live in the card's own project.
  const [col] = await db
    .select({ id: kanbanColumn.id })
    .from(kanbanColumn)
    .where(
      and(
        eq(kanbanColumn.id, toColumnId),
        eq(kanbanColumn.projectId, projectId),
      ),
    )
    .limit(1);
  if (!col) return null;

  const [row] = await db
    .update(kanbanCard)
    .set({ columnId: toColumnId, sortOrder: toSortOrder, updatedAt: sql`now()` })
    .where(eq(kanbanCard.id, cardId))
    .returning({
      id: kanbanCard.id,
      columnId: kanbanCard.columnId,
      projectId: kanbanCard.projectId,
      title: kanbanCard.title,
      description: kanbanCard.description,
      priority: kanbanCard.priority,
      dueDate: kanbanCard.dueDate,
      sortOrder: kanbanCard.sortOrder,
      assigneeId: kanbanCard.assigneeId,
      coverImageUrl: kanbanCard.coverImageUrl,
      artifactType: kanbanCard.artifactType,
      artifactId: kanbanCard.artifactId,
      artifactUrl: kanbanCard.artifactUrl,
      createdAt: kanbanCard.createdAt,
      updatedAt: kanbanCard.updatedAt,
    });
  return row ?? null;
}

// ---- labels ----------------------------------------------------------------

/** List a project's label definitions. Empty if the project is not in the org. */
export async function listLabels(orgId: string, projectId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return [];

  return db
    .select({
      id: cardLabel.id,
      projectId: cardLabel.projectId,
      name: cardLabel.name,
      color: cardLabel.color,
      createdAt: cardLabel.createdAt,
    })
    .from(cardLabel)
    .where(eq(cardLabel.projectId, projectId))
    .orderBy(asc(cardLabel.name));
}

/** Create a label in a project. Returns null if the project is not in the org. */
export async function createLabel(
  orgId: string,
  projectId: string,
  input: { name: string; color?: string },
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return null;

  const [row] = await db
    .insert(cardLabel)
    .values({ projectId, name: input.name, color: input.color ?? null })
    .returning({
      id: cardLabel.id,
      projectId: cardLabel.projectId,
      name: cardLabel.name,
      color: cardLabel.color,
      createdAt: cardLabel.createdAt,
    });
  return row;
}

/** Delete a label, scoped to a project in the org. True if a row was removed. */
export async function deleteLabel(
  orgId: string,
  projectId: string,
  labelId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, projectId))) return false;

  // FK cascade removes the label's assignments.
  const removed = await db
    .delete(cardLabel)
    .where(and(eq(cardLabel.id, labelId), eq(cardLabel.projectId, projectId)))
    .returning({ id: cardLabel.id });
  return removed.length > 0;
}

/**
 * Assign a label to a card. Verifies the card is in the org, and that the label
 * belongs to the card's own project. Idempotent on (card, label). Returns true
 * on success, false on any violation.
 */
export async function assignLabel(
  orgId: string,
  cardId: string,
  labelId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  const projectId = await cardProjectInOrg(db, orgId, cardId);
  if (!projectId) return false;

  // The label must belong to the card's project.
  const [label] = await db
    .select({ id: cardLabel.id })
    .from(cardLabel)
    .where(and(eq(cardLabel.id, labelId), eq(cardLabel.projectId, projectId)))
    .limit(1);
  if (!label) return false;

  await db
    .insert(cardLabelAssignment)
    .values({ cardId, labelId })
    .onConflictDoNothing({
      target: [cardLabelAssignment.cardId, cardLabelAssignment.labelId],
    });
  return true;
}

/** Remove a label from a card. Returns true if an assignment was removed. */
export async function unassignLabel(
  orgId: string,
  cardId: string,
  labelId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await cardProjectInOrg(db, orgId, cardId))) return false;

  const removed = await db
    .delete(cardLabelAssignment)
    .where(
      and(
        eq(cardLabelAssignment.cardId, cardId),
        eq(cardLabelAssignment.labelId, labelId),
      ),
    )
    .returning({ labelId: cardLabelAssignment.labelId });
  return removed.length > 0;
}
