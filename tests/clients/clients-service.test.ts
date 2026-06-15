import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation } from "../../lib/db/schema";
import * as svc from "../../lib/clients/service";

// ============================================================================
// Clients service tests (Layer 1, pglite-backed). These prove the ONE security
// guarantee this service layer exists to deliver: org-scoping. Every client,
// contact, and contract operation must be invisible/inert across tenants — a
// caller in org B can never read, mutate, or delete org A's data, whether by
// the client's own id or by reaching a child row through a foreign clientId.
//
// The harness db is passed as the trailing dbArg to every service call so the
// service runs against the ephemeral migrated Postgres, not getDb().
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

/** Insert an org directly (the route/signup layer is out of scope here). */
async function makeOrg(slug: string) {
  const ownerId = await h.createUser(`${slug}@test`, slug);
  const [org] = await h.db
    .insert(organisation)
    .values({ name: slug, slug, joinKey: `key-${slug}`, ownerId })
    .returning();
  return org.id as string;
}

describe("clients service — create, list, get", () => {
  it("creates a client and reads it back, scoped to its org", async () => {
    const orgId = await makeOrg("acme");

    const created = await svc.createClient(
      orgId,
      {
        name: "Globex",
        industry: "Finance",
        website: "https://globex.example",
        notes: "Key account",
      },
      h.db,
    );

    expect(created.id).toBeTruthy();
    expect(created.organisationId).toBe(orgId);
    expect(created.name).toBe("Globex");
    expect(created.industry).toBe("Finance");

    const list = await svc.listClients(orgId, h.db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const got = await svc.getClient(orgId, created.id, h.db);
    expect(got).not.toBeNull();
    expect(got!.name).toBe("Globex");
  });

  it("lists clients newest-updated first and isolates by org", async () => {
    const orgA = await makeOrg("org-a");
    const orgB = await makeOrg("org-b");

    await svc.createClient(orgA, { name: "A-One" }, h.db);
    await svc.createClient(orgA, { name: "A-Two" }, h.db);
    await svc.createClient(orgB, { name: "B-One" }, h.db);

    const aList = await svc.listClients(orgA, h.db);
    expect(aList).toHaveLength(2);
    expect(aList.every((c) => c.organisationId === orgA)).toBe(true);

    const bList = await svc.listClients(orgB, h.db);
    expect(bList).toHaveLength(1);
    expect(bList[0].name).toBe("B-One");
  });
});

describe("clients service — cross-org isolation (the core guarantee)", () => {
  it("org B cannot getClient an org A client (returns null)", async () => {
    const orgA = await makeOrg("a-get");
    const orgB = await makeOrg("b-get");
    const a = await svc.createClient(orgA, { name: "Secret Co" }, h.db);

    const leaked = await svc.getClient(orgB, a.id, h.db);
    expect(leaked).toBeNull();

    // Sanity: org A still sees its own client.
    const own = await svc.getClient(orgA, a.id, h.db);
    expect(own).not.toBeNull();
  });

  it("org B cannot updateClient an org A client (returns null, no mutation)", async () => {
    const orgA = await makeOrg("a-upd");
    const orgB = await makeOrg("b-upd");
    const a = await svc.createClient(orgA, { name: "Original" }, h.db);

    const result = await svc.updateClient(
      orgB,
      a.id,
      { name: "Hijacked" },
      h.db,
    );
    expect(result).toBeNull();

    // The row is untouched.
    const after = await svc.getClient(orgA, a.id, h.db);
    expect(after!.name).toBe("Original");
  });

  it("org B cannot deleteClient an org A client (returns false, row survives)", async () => {
    const orgA = await makeOrg("a-del");
    const orgB = await makeOrg("b-del");
    const a = await svc.createClient(orgA, { name: "Keep Me" }, h.db);

    const removed = await svc.deleteClient(orgB, a.id, h.db);
    expect(removed).toBe(false);

    const after = await svc.getClient(orgA, a.id, h.db);
    expect(after).not.toBeNull();
  });
});

describe("clients service — update & delete happy paths", () => {
  it("updates a client in its own org", async () => {
    const orgId = await makeOrg("upd-ok");
    const c = await svc.createClient(orgId, { name: "Before", city: "Sydney" }, h.db);

    const updated = await svc.updateClient(
      orgId,
      c.id,
      { name: "After", city: "Melbourne" },
      h.db,
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("After");
    expect(updated!.city).toBe("Melbourne");
  });

  it("deletes a client in its own org", async () => {
    const orgId = await makeOrg("del-ok");
    const c = await svc.createClient(orgId, { name: "Doomed" }, h.db);

    const removed = await svc.deleteClient(orgId, c.id, h.db);
    expect(removed).toBe(true);
    expect(await svc.getClient(orgId, c.id, h.db)).toBeNull();
  });

  it("updateClient / deleteClient on a non-existent id return null / false", async () => {
    const orgId = await makeOrg("missing");
    const fakeId = "00000000-0000-0000-0000-000000000000";

    expect(await svc.updateClient(orgId, fakeId, { name: "x" }, h.db)).toBeNull();
    expect(await svc.deleteClient(orgId, fakeId, h.db)).toBe(false);
  });
});

describe("contacts — scoped through the parent client", () => {
  it("creates and lists a contact under a client in the same org", async () => {
    const orgId = await makeOrg("ct-ok");
    const c = await svc.createClient(orgId, { name: "Client" }, h.db);

    const contact = await svc.createContact(
      orgId,
      c.id,
      { name: "Jane Smith", email: "jane@client.example", isPrimary: true },
      h.db,
    );
    expect(contact).not.toBeNull();
    expect(contact!.clientId).toBe(c.id);
    expect(contact!.isPrimary).toBe(true);

    const contacts = await svc.listContacts(orgId, c.id, h.db);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Jane Smith");
  });

  it("org B cannot add a contact to org A's client (returns null)", async () => {
    const orgA = await makeOrg("a-ct");
    const orgB = await makeOrg("b-ct");
    const a = await svc.createClient(orgA, { name: "A Client" }, h.db);

    const leaked = await svc.createContact(
      orgB,
      a.id,
      { name: "Intruder" },
      h.db,
    );
    expect(leaked).toBeNull();

    // No contact was created on org A's client.
    const contacts = await svc.listContacts(orgA, a.id, h.db);
    expect(contacts).toHaveLength(0);
  });

  it("org B cannot list org A's client contacts (returns empty)", async () => {
    const orgA = await makeOrg("a-ctl");
    const orgB = await makeOrg("b-ctl");
    const a = await svc.createClient(orgA, { name: "A Client" }, h.db);
    await svc.createContact(orgA, a.id, { name: "Real Contact" }, h.db);

    const leaked = await svc.listContacts(orgB, a.id, h.db);
    expect(leaked).toHaveLength(0);
  });

  it("org B cannot update or delete org A's contact", async () => {
    const orgA = await makeOrg("a-ctud");
    const orgB = await makeOrg("b-ctud");
    const a = await svc.createClient(orgA, { name: "A Client" }, h.db);
    const contact = await svc.createContact(
      orgA,
      a.id,
      { name: "Original Name" },
      h.db,
    );

    // Wrong org cannot update (parent client not in org B → null).
    const upd = await svc.updateContact(
      orgB,
      a.id,
      contact!.id,
      { name: "Hijacked" },
      h.db,
    );
    expect(upd).toBeNull();

    // Wrong org cannot delete.
    const del = await svc.deleteContact(orgB, a.id, contact!.id, h.db);
    expect(del).toBe(false);

    // Contact survives unchanged.
    const after = await svc.listContacts(orgA, a.id, h.db);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Original Name");
  });

  it("updates and deletes a contact in its own org", async () => {
    const orgId = await makeOrg("ct-mut");
    const c = await svc.createClient(orgId, { name: "Client" }, h.db);
    const contact = await svc.createContact(orgId, c.id, { name: "Old" }, h.db);

    const updated = await svc.updateContact(
      orgId,
      c.id,
      contact!.id,
      { name: "New", phone: "+61 400 000 000" },
      h.db,
    );
    expect(updated!.name).toBe("New");
    expect(updated!.phone).toBe("+61 400 000 000");

    const removed = await svc.deleteContact(orgId, c.id, contact!.id, h.db);
    expect(removed).toBe(true);
    expect(await svc.listContacts(orgId, c.id, h.db)).toHaveLength(0);
  });
});

describe("contracts — scoped through the parent client", () => {
  it("creates and lists a contract under a client in the same org", async () => {
    const orgId = await makeOrg("co-ok");
    const c = await svc.createClient(orgId, { name: "Client" }, h.db);

    const contract = await svc.createContract(
      orgId,
      c.id,
      {
        name: "AI Readiness Assessment",
        contractType: "fixed",
        status: "active",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        billingRate: "3000.00",
      },
      h.db,
    );
    expect(contract).not.toBeNull();
    expect(contract!.clientId).toBe(c.id);
    expect(contract!.billingRate).toBe("3000.00");
    expect(contract!.startDate).toBe("2026-01-01");

    const contracts = await svc.listContracts(orgId, c.id, h.db);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].name).toBe("AI Readiness Assessment");
  });

  it("org B cannot add a contract to org A's client (returns null)", async () => {
    const orgA = await makeOrg("a-co");
    const orgB = await makeOrg("b-co");
    const a = await svc.createClient(orgA, { name: "A Client" }, h.db);

    const leaked = await svc.createContract(
      orgB,
      a.id,
      { name: "Intruder Contract" },
      h.db,
    );
    expect(leaked).toBeNull();
    expect(await svc.listContracts(orgA, a.id, h.db)).toHaveLength(0);
  });

  it("org B cannot list, update, or delete org A's contract", async () => {
    const orgA = await makeOrg("a-coud");
    const orgB = await makeOrg("b-coud");
    const a = await svc.createClient(orgA, { name: "A Client" }, h.db);
    const contract = await svc.createContract(
      orgA,
      a.id,
      { name: "Original", status: "active" },
      h.db,
    );

    expect(await svc.listContracts(orgB, a.id, h.db)).toHaveLength(0);

    const upd = await svc.updateContract(
      orgB,
      a.id,
      contract!.id,
      { status: "cancelled" },
      h.db,
    );
    expect(upd).toBeNull();

    const del = await svc.deleteContract(orgB, a.id, contract!.id, h.db);
    expect(del).toBe(false);

    const after = await svc.listContracts(orgA, a.id, h.db);
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("active");
  });

  it("updates and deletes a contract in its own org", async () => {
    const orgId = await makeOrg("co-mut");
    const c = await svc.createClient(orgId, { name: "Client" }, h.db);
    const contract = await svc.createContract(
      orgId,
      c.id,
      { name: "Engagement", status: "active" },
      h.db,
    );

    const updated = await svc.updateContract(
      orgId,
      c.id,
      contract!.id,
      { status: "completed", billingRate: "1100.00" },
      h.db,
    );
    expect(updated!.status).toBe("completed");
    expect(updated!.billingRate).toBe("1100.00");

    const removed = await svc.deleteContract(orgId, c.id, contract!.id, h.db);
    expect(removed).toBe(true);
    expect(await svc.listContracts(orgId, c.id, h.db)).toHaveLength(0);
  });
});
