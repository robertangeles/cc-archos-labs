import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation, kanbanCard, cardLabelAssignment } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as kanbanService from "../../lib/kanban/service";

// ============================================================================
// Kanban service tests — real migration on ephemeral Postgres (pglite). Prove:
// column CRUD, getBoard assembles columns + cards (ordered, N+1-safe), card
// CRUD, moveCard updates column + order, and every cross-org / cross-project
// access is rejected (null / false / empty). The harness db is passed as dbArg.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

async function makeOrg(slug: string): Promise<{ orgId: string; userId: string }> {
  const userId = await h.createUser(`${slug}@test`, slug);
  const [org] = await h.db
    .insert(organisation)
    .values({ name: slug, slug, joinKey: `key-${slug}`, ownerId: userId })
    .returning({ id: organisation.id });
  return { orgId: org.id, userId };
}

/** Org + a project in it. Returns { orgId, userId, projectId }. */
async function makeOrgWithProject(
  slug: string,
): Promise<{ orgId: string; userId: string; projectId: string }> {
  const { orgId, userId } = await makeOrg(slug);
  const proj = await projectService.createProject(
    orgId,
    userId,
    { name: `${slug} project` },
    h.db,
  );
  return { orgId, userId, projectId: proj.id };
}

describe("column CRUD", () => {
  it("creates, lists (sorted), updates, and deletes columns", async () => {
    const { orgId, projectId } = await makeOrgWithProject("cols");

    const todo = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "Todo", sortOrder: 1 },
      h.db,
    );
    const doing = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "Doing", sortOrder: 0 },
      h.db,
    );
    expect(todo).not.toBeNull();
    expect(doing).not.toBeNull();

    // Listed by sortOrder ascending → Doing (0) before Todo (1).
    const cols = await kanbanService.listColumns(orgId, projectId, h.db);
    expect(cols.map((c) => c.name)).toEqual(["Doing", "Todo"]);

    const renamed = await kanbanService.updateColumn(
      orgId,
      projectId,
      todo!.id,
      { name: "Done" },
      h.db,
    );
    expect(renamed!.name).toBe("Done");

    const removed = await kanbanService.deleteColumn(orgId, projectId, todo!.id, h.db);
    expect(removed).toBe(true);
    const after = await kanbanService.listColumns(orgId, projectId, h.db);
    expect(after).toHaveLength(1);
  });

  it("rejects column ops for a project outside the org", async () => {
    const a = await makeOrgWithProject("col-a");
    const b = await makeOrg("col-b");

    // create scoped to org B against org A's project → null
    const created = await kanbanService.createColumn(
      b.orgId,
      a.projectId,
      { name: "intruder" },
      h.db,
    );
    expect(created).toBeNull();

    // a real column in A cannot be updated/deleted via org B
    const colA = await kanbanService.createColumn(
      a.orgId,
      a.projectId,
      { name: "A col" },
      h.db,
    );
    const upd = await kanbanService.updateColumn(
      b.orgId,
      a.projectId,
      colA!.id,
      { name: "x" },
      h.db,
    );
    expect(upd).toBeNull();
    const del = await kanbanService.deleteColumn(b.orgId, a.projectId, colA!.id, h.db);
    expect(del).toBe(false);

    // list scoped to org B → empty
    const listed = await kanbanService.listColumns(b.orgId, a.projectId, h.db);
    expect(listed).toHaveLength(0);
  });
});

describe("getBoard assembly", () => {
  it("returns columns ordered by sortOrder, each with their cards ordered", async () => {
    const { orgId, projectId } = await makeOrgWithProject("board");

    const c1 = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "Backlog", sortOrder: 0 },
      h.db,
    );
    const c2 = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "In Progress", sortOrder: 1 },
      h.db,
    );

    // Two cards in c1 (sort 1 then 0 → expect 0 first), one in c2.
    await kanbanService.createCard(
      orgId,
      projectId,
      c1!.id,
      { columnId: c1!.id, title: "second", sortOrder: 1 },
      null,
      h.db,
    );
    await kanbanService.createCard(
      orgId,
      projectId,
      c1!.id,
      { columnId: c1!.id, title: "first", sortOrder: 0 },
      null,
      h.db,
    );
    await kanbanService.createCard(
      orgId,
      projectId,
      c2!.id,
      { columnId: c2!.id, title: "lonely", sortOrder: 0 },
      null,
      h.db,
    );

    const board = await kanbanService.getBoard(orgId, projectId, h.db);
    expect(board).not.toBeNull();
    expect(board!).toHaveLength(2);

    // Column order by sortOrder.
    expect(board![0].name).toBe("Backlog");
    expect(board![1].name).toBe("In Progress");

    // Cards bucketed under their column, ordered by sortOrder.
    expect(board![0].cards.map((c) => c.title)).toEqual(["first", "second"]);
    expect(board![1].cards.map((c) => c.title)).toEqual(["lonely"]);
  });

  it("returns null for a project outside the org", async () => {
    const a = await makeOrgWithProject("board-a");
    const b = await makeOrg("board-b");
    const board = await kanbanService.getBoard(b.orgId, a.projectId, h.db);
    expect(board).toBeNull();
  });
});

describe("card CRUD", () => {
  it("creates a card, gets it, updates it, and deletes it", async () => {
    const { orgId, projectId } = await makeOrgWithProject("cards");
    const col = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "Todo" },
      h.db,
    );

    const card = await kanbanService.createCard(
      orgId,
      projectId,
      col!.id,
      { columnId: col!.id, title: "Map lineage", priority: "high" },
      null,
      h.db,
    );
    expect(card).not.toBeNull();
    expect(card!.priority).toBe("high");

    const fetched = await kanbanService.getCard(orgId, card!.id, h.db);
    expect(fetched!.title).toBe("Map lineage");

    const updated = await kanbanService.updateCard(
      orgId,
      card!.id,
      { title: "Map data lineage", priority: "urgent" },
      null,
      h.db,
    );
    expect(updated!.title).toBe("Map data lineage");
    expect(updated!.priority).toBe("urgent");

    const removed = await kanbanService.deleteCard(orgId, card!.id, null, h.db);
    expect(removed).toBe(true);
    const gone = await kanbanService.getCard(orgId, card!.id, h.db);
    expect(gone).toBeNull();
  });

  it("rejects creating a card when the column is not in the project", async () => {
    const a = await makeOrgWithProject("cc-a1");
    const a2 = await makeOrgWithProject("cc-a2"); // same harness, different project
    const colInA2 = await kanbanService.createColumn(
      a2.orgId,
      a2.projectId,
      { name: "Other" },
      h.db,
    );

    // Try to plant a card in project A1 pointing at a column from project A2.
    const planted = await kanbanService.createCard(
      a.orgId,
      a.projectId,
      colInA2!.id,
      { columnId: colInA2!.id, title: "cross-project" },
      null,
      h.db,
    );
    expect(planted).toBeNull();
  });

  it("org B cannot get, update, or delete org A's card", async () => {
    const a = await makeOrgWithProject("card-a");
    const b = await makeOrg("card-b");
    const colA = await kanbanService.createColumn(
      a.orgId,
      a.projectId,
      { name: "Todo" },
      h.db,
    );
    const cardA = await kanbanService.createCard(
      a.orgId,
      a.projectId,
      colA!.id,
      { columnId: colA!.id, title: "secret" },
      null,
      h.db,
    );

    expect(await kanbanService.getCard(b.orgId, cardA!.id, h.db)).toBeNull();
    expect(
      await kanbanService.updateCard(b.orgId, cardA!.id, { title: "x" }, null, h.db),
    ).toBeNull();
    expect(await kanbanService.deleteCard(b.orgId, cardA!.id, null, h.db)).toBe(false);

    // The card still exists and is untouched.
    const survivor = await kanbanService.getCard(a.orgId, cardA!.id, h.db);
    expect(survivor!.title).toBe("secret");
  });
});

describe("moveCard", () => {
  it("updates the card's column and sort order", async () => {
    const { orgId, projectId } = await makeOrgWithProject("move");
    const from = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "From" },
      h.db,
    );
    const to = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "To" },
      h.db,
    );
    const card = await kanbanService.createCard(
      orgId,
      projectId,
      from!.id,
      { columnId: from!.id, title: "movable", sortOrder: 0 },
      null,
      h.db,
    );

    const moved = await kanbanService.moveCard(orgId, card!.id, to!.id, 3, null, h.db);
    expect(moved).not.toBeNull();
    expect(moved!.columnId).toBe(to!.id);
    expect(moved!.sortOrder).toBe(3);

    // Confirm persisted.
    const [row] = await h.db
      .select({ columnId: kanbanCard.columnId, sortOrder: kanbanCard.sortOrder })
      .from(kanbanCard)
      .where(eq(kanbanCard.id, card!.id));
    expect(row.columnId).toBe(to!.id);
    expect(row.sortOrder).toBe(3);
  });

  it("rejects moving to a column in a different project (cross-project)", async () => {
    const a = await makeOrgWithProject("mv-a");
    // A second project in the SAME org with its own column.
    const otherProj = await projectService.createProject(
      a.orgId,
      a.userId,
      { name: "other" },
      h.db,
    );
    const foreignCol = await kanbanService.createColumn(
      a.orgId,
      otherProj.id,
      { name: "Foreign" },
      h.db,
    );
    const col = await kanbanService.createColumn(
      a.orgId,
      a.projectId,
      { name: "Home" },
      h.db,
    );
    const card = await kanbanService.createCard(
      a.orgId,
      a.projectId,
      col!.id,
      { columnId: col!.id, title: "stay" },
      null,
      h.db,
    );

    const moved = await kanbanService.moveCard(
      a.orgId,
      card!.id,
      foreignCol!.id,
      0,
      null,
      h.db,
    );
    expect(moved).toBeNull();

    // Card did not move.
    const still = await kanbanService.getCard(a.orgId, card!.id, h.db);
    expect(still!.columnId).toBe(col!.id);
  });

  it("rejects moving another org's card (cross-org)", async () => {
    const a = await makeOrgWithProject("mvx-a");
    const b = await makeOrgWithProject("mvx-b");
    const colA = await kanbanService.createColumn(
      a.orgId,
      a.projectId,
      { name: "A" },
      h.db,
    );
    const colB = await kanbanService.createColumn(
      b.orgId,
      b.projectId,
      { name: "B" },
      h.db,
    );
    const cardA = await kanbanService.createCard(
      a.orgId,
      a.projectId,
      colA!.id,
      { columnId: colA!.id, title: "A card" },
      null,
      h.db,
    );

    // Org B tries to move org A's card into org B's column.
    const moved = await kanbanService.moveCard(b.orgId, cardA!.id, colB!.id, 0, null, h.db);
    expect(moved).toBeNull();
  });
});

describe("labels", () => {
  it("creates, lists, assigns, unassigns, and deletes labels", async () => {
    const { orgId, projectId } = await makeOrgWithProject("labels");
    const col = await kanbanService.createColumn(
      orgId,
      projectId,
      { name: "Todo" },
      h.db,
    );
    const card = await kanbanService.createCard(
      orgId,
      projectId,
      col!.id,
      { columnId: col!.id, title: "Labelled" },
      null,
      h.db,
    );

    const label = await kanbanService.createLabel(
      orgId,
      projectId,
      { name: "Urgent", color: "#f00" },
      h.db,
    );
    expect(label).not.toBeNull();

    const labels = await kanbanService.listLabels(orgId, projectId, h.db);
    expect(labels).toHaveLength(1);

    const assigned = await kanbanService.assignLabel(orgId, card!.id, label!.id, h.db);
    expect(assigned).toBe(true);

    // Idempotent re-assign stays true and does not duplicate.
    expect(await kanbanService.assignLabel(orgId, card!.id, label!.id, h.db)).toBe(true);
    const rows = await h.db
      .select({ labelId: cardLabelAssignment.labelId })
      .from(cardLabelAssignment)
      .where(eq(cardLabelAssignment.cardId, card!.id));
    expect(rows).toHaveLength(1);

    const unassigned = await kanbanService.unassignLabel(orgId, card!.id, label!.id, h.db);
    expect(unassigned).toBe(true);

    const deleted = await kanbanService.deleteLabel(orgId, projectId, label!.id, h.db);
    expect(deleted).toBe(true);
    expect(await kanbanService.listLabels(orgId, projectId, h.db)).toHaveLength(0);
  });

  it("rejects label ops across orgs and assigning a foreign label", async () => {
    const a = await makeOrgWithProject("lbl-a");
    const b = await makeOrgWithProject("lbl-b");

    // create scoped to org B against org A's project → null
    expect(
      await kanbanService.createLabel(b.orgId, a.projectId, { name: "x" }, h.db),
    ).toBeNull();
    // list scoped to org B → empty
    expect(await kanbanService.listLabels(b.orgId, a.projectId, h.db)).toHaveLength(0);

    // A label in project B cannot be assigned to a card in project A.
    const labelB = await kanbanService.createLabel(
      b.orgId,
      b.projectId,
      { name: "B-only" },
      h.db,
    );
    const colA = await kanbanService.createColumn(
      a.orgId,
      a.projectId,
      { name: "Todo" },
      h.db,
    );
    const cardA = await kanbanService.createCard(
      a.orgId,
      a.projectId,
      colA!.id,
      { columnId: colA!.id, title: "A card" },
      null,
      h.db,
    );
    // Even from org A's context, label B is not in card A's project → false.
    expect(await kanbanService.assignLabel(a.orgId, cardA!.id, labelB!.id, h.db)).toBe(
      false,
    );
  });
});
