import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import {
  organisation,
  organisationMember,
  project,
  kanbanColumn,
  kanbanCard,
} from "../../lib/db/schema";
import {
  listAttachments,
  createAttachment,
  deleteAttachment,
} from "../../lib/kanban-attachments/service";

// ============================================================================
// Kanban card attachments — Layer 2 backend tests.
//
// All assertions run against a REAL Postgres engine (pglite) with the migration
// applied, so cross-org isolation is proven, not mocked. The core security
// guarantee under test: org B can never read, write, or delete an attachment
// that hangs off org A's card.
//
// The Cloudinary upload itself is not exercised here — it needs live creds.
// These tests cover the service's DB + IDOR logic, which is the security-
// relevant surface. The route's "not configured → 503" path is asserted by
// construction (cloudinaryConfigFromIntegration returns null without creds).
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

// A self-contained org/project/column/card graph for one org.
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
  return {
    ownerId,
    orgId: org.id,
    projectId: proj.id,
    columnId: col.id,
    cardId: card.id,
  };
}

const sampleMeta = {
  fileName: "spec.pdf",
  fileUrl: "https://res.cloudinary.com/demo/raw/upload/v1/spec.pdf",
  fileType: "application/pdf",
  fileSize: 2048,
};

describe("attachments — create / list / delete", () => {
  it("creates an attachment and lists it oldest-first", async () => {
    const a = await seedOrg("a");

    const first = await createAttachment(
      a.orgId,
      a.cardId,
      { ...sampleMeta, fileName: "first.pdf" },
      a.ownerId,
      h.db,
    );
    const second = await createAttachment(
      a.orgId,
      a.cardId,
      { ...sampleMeta, fileName: "second.png", fileType: "image/png" },
      a.ownerId,
      h.db,
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.fileName).toBe("first.pdf");
    expect(first?.uploadedBy).toBe(a.ownerId);

    const list = await listAttachments(a.orgId, a.cardId, h.db);
    expect(list).toHaveLength(2);
    expect(list[0].fileName).toBe("first.pdf");
    expect(list[1].fileName).toBe("second.png");
    expect(list[1].fileType).toBe("image/png");
  });

  it("stores nullable metadata (fileType / fileSize) as null", async () => {
    const a = await seedOrg("a");
    const created = await createAttachment(
      a.orgId,
      a.cardId,
      {
        fileName: "note.txt",
        fileUrl: "https://res.cloudinary.com/demo/raw/upload/v1/note.txt",
        fileType: null,
        fileSize: null,
      },
      a.ownerId,
      h.db,
    );
    expect(created).not.toBeNull();
    expect(created?.fileType).toBeNull();
    expect(created?.fileSize).toBeNull();
  });

  it("keeps the uploadedBy null when no user is given", async () => {
    const a = await seedOrg("a");
    const created = await createAttachment(
      a.orgId,
      a.cardId,
      sampleMeta,
      null,
      h.db,
    );
    expect(created?.uploadedBy).toBeNull();
  });

  it("deletes an attachment in the caller's org", async () => {
    const a = await seedOrg("a");
    const created = await createAttachment(
      a.orgId,
      a.cardId,
      sampleMeta,
      a.ownerId,
      h.db,
    );
    const removed = await deleteAttachment(a.orgId, created!.id, h.db);
    expect(removed).toBe(true);
    expect(await listAttachments(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });

  it("returns false when deleting an attachment that does not exist", async () => {
    const a = await seedOrg("a");
    const removed = await deleteAttachment(
      a.orgId,
      "00000000-0000-0000-0000-000000000000",
      h.db,
    );
    expect(removed).toBe(false);
  });
});

describe("attachments — cross-org isolation (IDOR)", () => {
  it("does not create an attachment on a card in another org", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    // Org B tries to attach to org A's card.
    const created = await createAttachment(
      b.orgId,
      a.cardId,
      sampleMeta,
      b.ownerId,
      h.db,
    );
    expect(created).toBeNull();
    // Nothing leaked into org A's card either.
    expect(await listAttachments(a.orgId, a.cardId, h.db)).toHaveLength(0);
  });

  it("does not list another org's attachments", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    await createAttachment(a.orgId, a.cardId, sampleMeta, a.ownerId, h.db);

    // Org B asking for org A's card sees nothing.
    expect(await listAttachments(b.orgId, a.cardId, h.db)).toHaveLength(0);
    // Org A still sees its own.
    expect(await listAttachments(a.orgId, a.cardId, h.db)).toHaveLength(1);
  });

  it("does not delete another org's attachment", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    const created = await createAttachment(
      a.orgId,
      a.cardId,
      sampleMeta,
      a.ownerId,
      h.db,
    );

    // Org B tries to delete org A's attachment by id.
    const removed = await deleteAttachment(b.orgId, created!.id, h.db);
    expect(removed).toBe(false);
    // The attachment survives.
    expect(await listAttachments(a.orgId, a.cardId, h.db)).toHaveLength(1);
  });
});
