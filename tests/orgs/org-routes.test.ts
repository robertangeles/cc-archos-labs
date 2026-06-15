import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import type { DB } from "../../lib/db";

// ============================================================================
// Service-level contract test for the organisation API routes.
//
// The route handlers themselves are thin and depend on next/headers cookies +
// the session JWT, which are awkward to fake in a unit test. The LOGIC the
// routes enforce (join states, role changes, last-owner protection) lives in
// lib/orgs/service.ts. We exercise that service against a REAL Postgres engine
// (pglite, in-process) so the contract the routes rely on is proven.
//
// lib/orgs/service.ts calls getDb() internally (no db argument), so we mock the
// db module to hand back the pglite-backed harness client. The mock reads a
// mutable holder lazily on every getDb() call, so the harness created in
// beforeAll is visible despite vi.mock being hoisted above the imports.
// ============================================================================

const dbHolder = vi.hoisted(() => ({ current: null as DB | null }));

vi.mock("../../lib/db", () => ({
  getDb: () => {
    if (!dbHolder.current) throw new Error("test db not initialised");
    return dbHolder.current;
  },
}));

// Imported AFTER the mock is registered so the service binds to the mocked db.
import * as orgService from "../../lib/orgs/service";

let harness: OrgTestDb;

beforeAll(async () => {
  harness = await makeOrgTestDb();
  dbHolder.current = harness.db;
});

afterAll(async () => {
  await harness.close();
});

// Each test starts from an empty membership/org state.
beforeEach(async () => {
  await harness.client.query(`DELETE FROM "organisation_member"`);
  await harness.client.query(`DELETE FROM "organisation"`);
  await harness.client.query(`DELETE FROM "users"`);
});

describe("createOrg + getOrgWithMembers", () => {
  it("creates an org with the creator as the sole owner", async () => {
    const owner = await harness.createUser("owner@example.com", "Owner");

    const org = await orgService.createOrg(owner, {
      name: "Acme",
      description: "test org",
    });

    expect(org.id).toBeTruthy();
    expect(org.ownerId).toBe(owner);
    expect(org.joinKey).toBeTruthy();

    const detail = await orgService.getOrgWithMembers(org.id);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("Acme");
    expect(detail!.members).toHaveLength(1);
    expect(detail!.members[0].userId).toBe(owner);
    expect(detail!.members[0].role).toBe("owner");

    const owners = await orgService.countOwners(org.id);
    expect(owners).toBe(1);
  });

  it("returns null for an unknown org id", async () => {
    const detail = await orgService.getOrgWithMembers(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(detail).toBeNull();
  });
});

describe("joinOrgByKey", () => {
  it("joins a new member with the correct join key", async () => {
    const owner = await harness.createUser("owner2@example.com", "Owner");
    const joiner = await harness.createUser("joiner@example.com", "Joiner");
    const org = await orgService.createOrg(owner, { name: "Beta" });

    const result = await orgService.joinOrgByKey(joiner, org.joinKey);
    expect(result.status).toBe("joined");
    expect(result.orgId).toBe(org.id);

    const detail = await orgService.getOrgWithMembers(org.id);
    expect(detail!.members).toHaveLength(2);
    const joinerRow = detail!.members.find((m) => m.userId === joiner);
    expect(joinerRow?.role).toBe("member");
  });

  it("returns already_member when the user is already in the org", async () => {
    const owner = await harness.createUser("owner3@example.com", "Owner");
    const org = await orgService.createOrg(owner, { name: "Gamma" });

    // The owner is already a member.
    const result = await orgService.joinOrgByKey(owner, org.joinKey);
    expect(result.status).toBe("already_member");
    expect(result.orgId).toBe(org.id);
  });

  it("returns not_found for an invalid join key", async () => {
    const joiner = await harness.createUser("joiner2@example.com", "Joiner");
    const result = await orgService.joinOrgByKey(joiner, "deadbeef-not-a-real-key");
    expect(result.status).toBe("not_found");
    expect(result.orgId).toBeUndefined();
  });
});

describe("updateMemberRole + countOwners (last-owner logic)", () => {
  it("promotes a member to admin", async () => {
    const owner = await harness.createUser("owner4@example.com", "Owner");
    const joiner = await harness.createUser("joiner3@example.com", "Joiner");
    const org = await orgService.createOrg(owner, { name: "Delta" });
    await orgService.joinOrgByKey(joiner, org.joinKey);

    const detail = await orgService.getOrgWithMembers(org.id);
    const joinerMember = detail!.members.find((m) => m.userId === joiner)!;

    const ok = await orgService.updateMemberRole(org.id, joinerMember.id, "admin");
    expect(ok).toBe(true);

    const after = await orgService.getOrgWithMembers(org.id);
    const joinerAfter = after!.members.find((m) => m.userId === joiner);
    expect(joinerAfter?.role).toBe("admin");
  });

  it("countOwners reflects a second promoted owner and blocks no demotion when >1", async () => {
    const owner = await harness.createUser("owner5@example.com", "Owner");
    const joiner = await harness.createUser("joiner4@example.com", "Joiner");
    const org = await orgService.createOrg(owner, { name: "Epsilon" });
    await orgService.joinOrgByKey(joiner, org.joinKey);

    const detail = await orgService.getOrgWithMembers(org.id);
    const joinerMember = detail!.members.find((m) => m.userId === joiner)!;
    await orgService.updateMemberRole(org.id, joinerMember.id, "owner");

    // Two owners now — the route's last-owner guard would NOT block a demotion.
    expect(await orgService.countOwners(org.id)).toBe(2);

    // Demote the second owner back to member; one owner remains.
    await orgService.updateMemberRole(org.id, joinerMember.id, "member");
    expect(await orgService.countOwners(org.id)).toBe(1);
  });
});

describe("removeMember", () => {
  it("removes a member and reports success", async () => {
    const owner = await harness.createUser("owner6@example.com", "Owner");
    const joiner = await harness.createUser("joiner5@example.com", "Joiner");
    const org = await orgService.createOrg(owner, { name: "Zeta" });
    await orgService.joinOrgByKey(joiner, org.joinKey);

    const detail = await orgService.getOrgWithMembers(org.id);
    const joinerMember = detail!.members.find((m) => m.userId === joiner)!;

    const removed = await orgService.removeMember(org.id, joinerMember.id);
    expect(removed).toBe(true);

    const after = await orgService.getOrgWithMembers(org.id);
    expect(after!.members).toHaveLength(1);
    expect(after!.members.some((m) => m.userId === joiner)).toBe(false);
  });

  it("returns false when the member id does not exist", async () => {
    const owner = await harness.createUser("owner7@example.com", "Owner");
    const org = await orgService.createOrg(owner, { name: "Eta" });

    const removed = await orgService.removeMember(
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(removed).toBe(false);

    // The last owner is still present — the route's guard relies on this count.
    expect(await orgService.countOwners(org.id)).toBe(1);
  });
});
