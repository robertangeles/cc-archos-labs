import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import {
  organisation,
  organisationMember,
  client,
  clientContract,
} from "../../lib/db/schema";
import {
  listAttachments,
  createAttachment,
  deleteAttachment,
} from "../../lib/contract-attachments/service";

// ============================================================================
// Contract attachments — Layer 2 backend tests.
//
// Mirrors the kanban card attachment tests against a REAL Postgres engine
// (pglite) with the migration applied. The core guarantee under test: org B can
// never read, write, or delete an attachment that hangs off org A's contract
// (IDOR via contract -> client -> organisation_id).
//
// The Cloudinary upload itself is not exercised here — it needs live creds.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

// A self-contained org/client/contract graph for one org.
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
  const [cl] = await h.db
    .insert(client)
    .values({ organisationId: org.id, name: `Client ${label}` })
    .returning();
  const [contract] = await h.db
    .insert(clientContract)
    .values({ clientId: cl.id, name: `Contract ${label}` })
    .returning();
  return {
    ownerId,
    orgId: org.id,
    clientId: cl.id,
    contractId: contract.id,
  };
}

const sampleMeta = {
  fileName: "msa.pdf",
  fileUrl: "https://res.cloudinary.com/demo/raw/upload/v1/msa.pdf",
  fileType: "application/pdf",
  fileSize: 4096,
};

describe("contract attachments — create / list / delete", () => {
  it("creates an attachment and lists it oldest-first", async () => {
    const a = await seedOrg("a");

    const first = await createAttachment(
      a.orgId,
      a.contractId,
      { ...sampleMeta, fileName: "first.pdf" },
      a.ownerId,
      h.db,
    );
    const second = await createAttachment(
      a.orgId,
      a.contractId,
      { ...sampleMeta, fileName: "second.png", fileType: "image/png" },
      a.ownerId,
      h.db,
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.fileName).toBe("first.pdf");
    expect(first?.uploadedBy).toBe(a.ownerId);

    const list = await listAttachments(a.orgId, a.contractId, h.db);
    expect(list).toHaveLength(2);
    expect(list[0].fileName).toBe("first.pdf");
    expect(list[1].fileName).toBe("second.png");
    expect(list[1].fileType).toBe("image/png");
  });

  it("stores nullable metadata (fileType / fileSize) as null", async () => {
    const a = await seedOrg("a");
    const created = await createAttachment(
      a.orgId,
      a.contractId,
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

  it("deletes an attachment in the caller's org", async () => {
    const a = await seedOrg("a");
    const created = await createAttachment(
      a.orgId,
      a.contractId,
      sampleMeta,
      a.ownerId,
      h.db,
    );
    const removed = await deleteAttachment(a.orgId, created!.id, h.db);
    expect(removed).toBe(true);
    expect(await listAttachments(a.orgId, a.contractId, h.db)).toHaveLength(0);
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

describe("contract attachments — cross-org isolation (IDOR)", () => {
  it("does not create an attachment on a contract in another org", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    const created = await createAttachment(
      b.orgId,
      a.contractId,
      sampleMeta,
      b.ownerId,
      h.db,
    );
    expect(created).toBeNull();
    expect(await listAttachments(a.orgId, a.contractId, h.db)).toHaveLength(0);
  });

  it("does not list another org's attachments", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    await createAttachment(a.orgId, a.contractId, sampleMeta, a.ownerId, h.db);

    expect(await listAttachments(b.orgId, a.contractId, h.db)).toHaveLength(0);
    expect(await listAttachments(a.orgId, a.contractId, h.db)).toHaveLength(1);
  });

  it("does not delete another org's attachment", async () => {
    const a = await seedOrg("a");
    const b = await seedOrg("b");

    const created = await createAttachment(
      a.orgId,
      a.contractId,
      sampleMeta,
      a.ownerId,
      h.db,
    );

    const removed = await deleteAttachment(b.orgId, created!.id, h.db);
    expect(removed).toBe(false);
    expect(await listAttachments(a.orgId, a.contractId, h.db)).toHaveLength(1);
  });
});
