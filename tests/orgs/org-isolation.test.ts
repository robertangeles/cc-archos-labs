import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import {
  organisation,
  organisationMember,
  client,
  project,
  kanbanColumn,
  kanbanCard,
} from "../../lib/db/schema";
import { createDefaultOrgForUser } from "../../lib/orgs/service";

// ============================================================================
// Layer 1 foundation tests (Eng-2/D2). These run the real migration against an
// ephemeral Postgres (pglite) and prove the guarantees the whole migration
// exists to deliver: cross-org isolation, migration re-runnability, and
// idempotent default-org creation.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

describe("migration 0025 — schema + idempotency", () => {
  it("creates all 14 org tables and round-trips a full object graph", async () => {
    const ownerId = await h.createUser("owner@a.test", "Owner A");

    const [org] = await h.db
      .insert(organisation)
      .values({ name: "Acme", slug: "acme", joinKey: "k1", ownerId })
      .returning();
    await h.db
      .insert(organisationMember)
      .values({ organisationId: org.id, userId: ownerId, role: "owner" });
    const [cl] = await h.db
      .insert(client)
      .values({ organisationId: org.id, name: "Globex" })
      .returning();
    const [proj] = await h.db
      .insert(project)
      .values({ organisationId: org.id, clientId: cl.id, userId: ownerId, name: "Q3 Engagement" })
      .returning();
    const [col] = await h.db
      .insert(kanbanColumn)
      .values({ projectId: proj.id, name: "Discovery", sortOrder: 0 })
      .returning();
    const [card] = await h.db
      .insert(kanbanCard)
      .values({ columnId: col.id, projectId: proj.id, title: "Map data lineage", priority: "high" })
      .returning();

    expect(card.id).toBeTruthy();
    expect(card.priority).toBe("high");

    const cards = await h.db
      .select()
      .from(kanbanCard)
      .where(eq(kanbanCard.projectId, proj.id));
    expect(cards).toHaveLength(1);
  });

  it("is idempotent — re-running the migration does not throw", async () => {
    await expect(h.applyMigration()).resolves.not.toThrow();
    // Tables still usable after a second apply.
    const ownerId = await h.createUser("owner2@a.test");
    const [org] = await h.db
      .insert(organisation)
      .values({ name: "Re-run Co", slug: "rerun", joinKey: "k-rerun", ownerId })
      .returning();
    expect(org.id).toBeTruthy();
  });
});

describe("cross-org isolation (the core security guarantee)", () => {
  it("an org-scoped query returns only that org's rows", async () => {
    const userA = await h.createUser("a@test", "A");
    const userB = await h.createUser("b@test", "B");
    const [orgA] = await h.db
      .insert(organisation)
      .values({ name: "Org A", slug: "org-a", joinKey: "ka", ownerId: userA })
      .returning();
    const [orgB] = await h.db
      .insert(organisation)
      .values({ name: "Org B", slug: "org-b", joinKey: "kb", ownerId: userB })
      .returning();

    await h.db.insert(project).values({ organisationId: orgA.id, name: "A-Project" });
    await h.db.insert(project).values({ organisationId: orgB.id, name: "B-Project" });

    const aProjects = await h.db
      .select()
      .from(project)
      .where(eq(project.organisationId, orgA.id));
    expect(aProjects).toHaveLength(1);
    expect(aProjects[0].name).toBe("A-Project");
  });

  it("blocks cross-org IDOR: org B cannot read org A's card by id", async () => {
    const userA = await h.createUser("a2@test", "A");
    const userB = await h.createUser("b2@test", "B");
    const [orgA] = await h.db
      .insert(organisation)
      .values({ name: "Org A", slug: "oa", joinKey: "ka2", ownerId: userA })
      .returning();
    const [orgB] = await h.db
      .insert(organisation)
      .values({ name: "Org B", slug: "ob", joinKey: "kb2", ownerId: userB })
      .returning();
    const [projA] = await h.db
      .insert(project)
      .values({ organisationId: orgA.id, name: "A" })
      .returning();
    const [colA] = await h.db
      .insert(kanbanColumn)
      .values({ projectId: projA.id, name: "Todo" })
      .returning();
    const [cardA] = await h.db
      .insert(kanbanCard)
      .values({ columnId: colA.id, projectId: projA.id, title: "secret" })
      .returning();

    // The IDOR-safe access pattern: resource id AND org membership of the
    // requester. User B (org B) requesting card A scoped to org B → nothing.
    const leaked = await h.db
      .select({ id: kanbanCard.id })
      .from(kanbanCard)
      .innerJoin(project, eq(kanbanCard.projectId, project.id))
      .where(and(eq(kanbanCard.id, cardA.id), eq(project.organisationId, orgB.id)));
    expect(leaked).toHaveLength(0);

    // Sanity: the same query scoped to org A DOES find it.
    const found = await h.db
      .select({ id: kanbanCard.id })
      .from(kanbanCard)
      .innerJoin(project, eq(kanbanCard.projectId, project.id))
      .where(and(eq(kanbanCard.id, cardA.id), eq(project.organisationId, orgA.id)));
    expect(found).toHaveLength(1);
  });
});

describe("createDefaultOrgForUser — idempotent signup/backfill", () => {
  it("creates one org + one owner membership, and is a no-op on re-run", async () => {
    const userId = await h.createUser("carol@test", "Carol");

    const orgId1 = await createDefaultOrgForUser(userId, "Carol", h.db);
    const orgId2 = await createDefaultOrgForUser(userId, "Carol", h.db);
    expect(orgId1).toBe(orgId2);

    const orgs = await h.db
      .select({ id: organisation.id })
      .from(organisation)
      .where(eq(organisation.ownerId, userId));
    expect(orgs).toHaveLength(1);

    const members = await h.db
      .select({ id: organisationMember.id, role: organisationMember.role })
      .from(organisationMember)
      .where(
        and(
          eq(organisationMember.organisationId, orgId1),
          eq(organisationMember.userId, userId),
        ),
      );
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
  });
});
