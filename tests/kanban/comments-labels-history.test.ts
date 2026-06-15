import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import {
  organisation,
  organisationMember,
  project,
  kanbanColumn,
  kanbanCard,
  cardLabel,
} from "../../lib/db/schema";
import {
  listComments,
  createComment,
  deleteComment,
} from "../../lib/kanban/comments";
import {
  createCard,
  moveCard,
  getCardLabels,
  assignLabel,
  unassignLabel,
  createLabel,
  listCardActivity,
  getBoard,
} from "../../lib/kanban/service";

// ============================================================================
// Kanban comments / labels / per-card history — Layer 2 backend tests.
//
// All assertions run against a REAL Postgres engine (pglite) with the migration
// applied, so cross-org isolation is proven, not mocked. The core security
// guarantee under test: org B can never read, write, or delete a child row that
// hangs off org A's card.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

// A self-contained org/project/column/card graph for one org. Returns the ids a
// test needs plus the owner user id (member of that org).
async function seedOrg(label: string) {
  const ownerId = await h.createUser(`owner-${label}@test`, `Owner ${label}`);
  const [org] = await h.db
    .insert(organisation)
    .values({
      name: `Org ${label}`,
      slug: `org-${label}`,
      joinKey: `key-${label}`,
      ownerId,
    })
    .returning();
  await h.db
    .insert(organisationMember)
    .values({ organisationId: org.id, userId: ownerId, role: "owner" });
  const [proj] = await h.db
    .insert(project)
    .values({ organisationId: org.id, name: `Project ${label}` })
    .returning();
  const [col] = await h.db
    .insert(kanbanColumn)
    .values({ projectId: proj.id, name: "Todo" })
    .returning();
  const [card] = await h.db
    .insert(kanbanCard)
    .values({ columnId: col.id, projectId: proj.id, title: `Card ${label}` })
    .returning();
  return { ownerId, orgId: org.id, projectId: proj.id, columnId: col.id, cardId: card.id };
}

describe("comments — create / list / delete", () => {
  it("creates a comment and lists it oldest-first with author info", async () => {
    const a = await seedOrg("a");

    const c1 = await createComment(a.orgId, a.cardId, a.ownerId, "first", h.db);
    const c2 = await createComment(a.orgId, a.cardId, a.ownerId, "second", h.db);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(c1?.authorName).toBe("Owner a");
    expect(c1?.authorEmail).toBe("owner-a@test");

    const list = await listComments(a.orgId, a.cardId, h.db);
    expect(list).toHaveLength(2);
    expect(list[0].body).toBe("first");
    expect(list[1].body).toBe("second");
    expect(list[0].authorName).toBe("Owner a");
  });

  it("rejects an empty / whitespace-only body", async () => {
    const a = await seedOrg("a");
    expect(await createComment(a.orgId, a.cardId, a.ownerId, "   ", h.db)).toBeNull();
    expect(await listComments(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });

  it("lets the author delete their own comment", async () => {
    const a = await seedOrg("a");
    const c = await createComment(a.orgId, a.cardId, a.ownerId, "mine", h.db);
    const removed = await deleteComment(
      a.orgId,
      c!.id,
      a.ownerId,
      "member",
      h.db,
    );
    expect(removed).toBe(true);
    expect(await listComments(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });

  it("blocks a non-author member from deleting another's comment, but allows owner/admin", async () => {
    const a = await seedOrg("a");
    const otherMember = await h.createUser("other@test", "Other");
    await h.db
      .insert(organisationMember)
      .values({ organisationId: a.orgId, userId: otherMember, role: "member" });

    const c = await createComment(a.orgId, a.cardId, a.ownerId, "owner's note", h.db);

    // Non-author member: denied.
    expect(
      await deleteComment(a.orgId, c!.id, otherMember, "member", h.db),
    ).toBe(false);
    expect(await listComments(a.orgId, a.cardId, h.db)).toHaveLength(1);

    // Admin (not author): allowed.
    expect(
      await deleteComment(a.orgId, c!.id, otherMember, "admin", h.db),
    ).toBe(true);
    expect(await listComments(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });
});

describe("comments — cross-org isolation", () => {
  it("org B cannot create, read, or delete comments on org A's card", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    // Seed a real comment on A's card as A.
    const real = await createComment(a.orgId, a.cardId, a.ownerId, "A secret", h.db);
    expect(real).not.toBeNull();

    // B cannot create on A's card (card not in B's org).
    expect(
      await createComment(b.orgId, a.cardId, b.ownerId, "intruder", h.db),
    ).toBeNull();

    // B cannot read A's card comments.
    expect(await listComments(b.orgId, a.cardId, h.db)).toHaveLength(0);

    // B (even as owner of B) cannot delete A's comment.
    expect(
      await deleteComment(b.orgId, real!.id, b.ownerId, "owner", h.db),
    ).toBe(false);

    // A's comment is still there.
    expect(await listComments(a.orgId, a.cardId, h.db)).toHaveLength(1);
  });
});

describe("labels — assign / get / unassign + cross-org", () => {
  it("assigns a label to a card, lists it, and unassigns it", async () => {
    const a = await seedOrg("a");
    const label = await createLabel(a.orgId, a.projectId, { name: "Urgent", color: "red" }, h.db);
    expect(label).not.toBeNull();

    expect(await getCardLabels(a.orgId, a.cardId, h.db)).toHaveLength(0);

    expect(await assignLabel(a.orgId, a.cardId, label!.id, h.db)).toBe(true);
    const assigned = await getCardLabels(a.orgId, a.cardId, h.db);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].name).toBe("Urgent");
    expect(assigned[0].color).toBe("red");

    // Idempotent.
    expect(await assignLabel(a.orgId, a.cardId, label!.id, h.db)).toBe(true);
    expect(await getCardLabels(a.orgId, a.cardId, h.db)).toHaveLength(1);

    expect(await unassignLabel(a.orgId, a.cardId, label!.id, h.db)).toBe(true);
    expect(await getCardLabels(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });

  it("org B cannot read or assign labels on org A's card", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");
    const labelA = await createLabel(a.orgId, a.projectId, { name: "A-only" }, h.db);
    await assignLabel(a.orgId, a.cardId, labelA!.id, h.db);

    // B cannot read A's card labels.
    expect(await getCardLabels(b.orgId, a.cardId, h.db)).toHaveLength(0);

    // B cannot assign its own (or A's) label to A's card.
    const labelB = await createLabel(b.orgId, b.projectId, { name: "B-only" }, h.db);
    expect(await assignLabel(b.orgId, a.cardId, labelB!.id, h.db)).toBe(false);
    expect(await assignLabel(b.orgId, a.cardId, labelA!.id, h.db)).toBe(false);

    // A's card still has only its one label.
    expect(await getCardLabels(a.orgId, a.cardId, h.db)).toHaveLength(1);
  });
});

describe("per-card history — listCardActivity", () => {
  it("returns logged events after createCard and moveCard, newest-first, with actor name", async () => {
    const a = await seedOrg("a");
    const [col2] = await h.db
      .insert(kanbanColumn)
      .values({ projectId: a.projectId, name: "Doing" })
      .returning();

    const card = await createCard(
      a.orgId,
      a.projectId,
      a.columnId,
      { columnId: a.columnId, title: "Tracked card" },
      a.ownerId,
      h.db,
    );
    expect(card).not.toBeNull();

    await moveCard(a.orgId, card!.id, col2.id, 0, a.ownerId, h.db);

    const history = await listCardActivity(a.orgId, card!.id, h.db);
    expect(history).toHaveLength(2);
    // Newest first: move then create.
    expect(history[0].action).toBe("moved card");
    expect(history[1].action).toBe("created card");
    expect(history[0].entityType).toBe("card");
    expect(history[0].entityId).toBe(card!.id);
    expect(history[0].actorName).toBe("Owner a");
  });

  it("org B cannot read org A's card history", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");
    const card = await createCard(
      a.orgId,
      a.projectId,
      a.columnId,
      { columnId: a.columnId, title: "A history" },
      a.ownerId,
      h.db,
    );
    expect(await listCardActivity(b.orgId, card!.id, h.db)).toHaveLength(0);
    expect(await listCardActivity(a.orgId, card!.id, h.db)).toHaveLength(1);
  });
});

describe("getBoard — enriched with labels + commentCount", () => {
  it("each card carries its labels array and a comment count", async () => {
    const a = await seedOrg("a");
    const label = await createLabel(a.orgId, a.projectId, { name: "Risk" }, h.db);
    await assignLabel(a.orgId, a.cardId, label!.id, h.db);
    await createComment(a.orgId, a.cardId, a.ownerId, "one", h.db);
    await createComment(a.orgId, a.cardId, a.ownerId, "two", h.db);

    const board = await getBoard(a.orgId, a.projectId, h.db);
    expect(board).not.toBeNull();
    const card = board!.flatMap((c) => c.cards).find((c) => c.id === a.cardId);
    expect(card).toBeDefined();
    expect(card!.labels).toHaveLength(1);
    expect(card!.labels[0].name).toBe("Risk");
    expect(card!.commentCount).toBe(2);
  });

  it("a card with no labels or comments reports empty + zero (additive defaults)", async () => {
    const a = await seedOrg("a");
    const board = await getBoard(a.orgId, a.projectId, h.db);
    const card = board!.flatMap((c) => c.cards).find((c) => c.id === a.cardId);
    expect(card!.labels).toEqual([]);
    expect(card!.commentCount).toBe(0);
  });
});
