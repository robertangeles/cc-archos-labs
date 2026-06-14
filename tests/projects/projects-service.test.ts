import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation, projectMember } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";

// ============================================================================
// Project service tests — run the real migration against an ephemeral Postgres
// (pglite) and prove: CRUD, the cross-org isolation guarantee (org B can never
// read/update/delete org A's project or touch its members/activity), and the
// activity feed. Every service call passes the harness db as dbArg.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

/** Create an org owned by a fresh user. Returns { orgId, userId }. */
async function makeOrg(slug: string): Promise<{ orgId: string; userId: string }> {
  const userId = await h.createUser(`${slug}@test`, slug);
  const [org] = await h.db
    .insert(organisation)
    .values({ name: slug, slug, joinKey: `key-${slug}`, ownerId: userId })
    .returning({ id: organisation.id });
  return { orgId: org.id, userId };
}

describe("project CRUD", () => {
  it("creates, lists, and gets a project scoped to its org", async () => {
    const { orgId, userId } = await makeOrg("acme");

    const created = await projectService.createProject(
      orgId,
      userId,
      { name: "Q3 Engagement", description: "Data lineage" },
      h.db,
    );
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Q3 Engagement");
    expect(created.status).toBe("active");
    expect(created.organisationId).toBe(orgId);

    const list = await projectService.listProjects(orgId, h.db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const fetched = await projectService.getProject(orgId, created.id, h.db);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Q3 Engagement");
  });

  it("updates a project's fields", async () => {
    const { orgId, userId } = await makeOrg("globex");
    const created = await projectService.createProject(
      orgId,
      userId,
      { name: "Initial" },
      h.db,
    );

    const updated = await projectService.updateProject(
      orgId,
      created.id,
      { name: "Renamed", status: "on_hold" },
      h.db,
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.status).toBe("on_hold");
  });

  it("deletes a project and reports the result as a boolean", async () => {
    const { orgId, userId } = await makeOrg("initech");
    const created = await projectService.createProject(
      orgId,
      userId,
      { name: "To delete" },
      h.db,
    );

    const removed = await projectService.deleteProject(orgId, created.id, h.db);
    expect(removed).toBe(true);

    const gone = await projectService.getProject(orgId, created.id, h.db);
    expect(gone).toBeNull();

    // Deleting again is a no-op false (already gone).
    const again = await projectService.deleteProject(orgId, created.id, h.db);
    expect(again).toBe(false);
  });
});

describe("cross-org isolation (project)", () => {
  it("org B cannot get, update, or delete org A's project", async () => {
    const a = await makeOrg("org-a");
    const b = await makeOrg("org-b");

    const projA = await projectService.createProject(
      a.orgId,
      a.userId,
      { name: "A-secret" },
      h.db,
    );

    // get scoped to org B → null
    const leaked = await projectService.getProject(b.orgId, projA.id, h.db);
    expect(leaked).toBeNull();

    // update scoped to org B → null, and the row is untouched
    const updated = await projectService.updateProject(
      b.orgId,
      projA.id,
      { name: "hijacked" },
      h.db,
    );
    expect(updated).toBeNull();
    const stillA = await projectService.getProject(a.orgId, projA.id, h.db);
    expect(stillA!.name).toBe("A-secret");

    // delete scoped to org B → false, and the row survives
    const removed = await projectService.deleteProject(b.orgId, projA.id, h.db);
    expect(removed).toBe(false);
    const survivor = await projectService.getProject(a.orgId, projA.id, h.db);
    expect(survivor).not.toBeNull();
  });

  it("listProjects only returns the caller org's projects", async () => {
    const a = await makeOrg("list-a");
    const b = await makeOrg("list-b");
    await projectService.createProject(a.orgId, a.userId, { name: "A1" }, h.db);
    await projectService.createProject(a.orgId, a.userId, { name: "A2" }, h.db);
    await projectService.createProject(b.orgId, b.userId, { name: "B1" }, h.db);

    const aList = await projectService.listProjects(a.orgId, h.db);
    const bList = await projectService.listProjects(b.orgId, h.db);
    expect(aList).toHaveLength(2);
    expect(bList).toHaveLength(1);
    expect(bList[0].name).toBe("B1");
  });
});

describe("project members", () => {
  it("adds, lists, and removes a member on a project in the org", async () => {
    const { orgId, userId } = await makeOrg("members-co");
    const proj = await projectService.createProject(
      orgId,
      userId,
      { name: "Has members" },
      h.db,
    );
    const memberUserId = await h.createUser("member@test", "Member");

    const added = await projectService.addProjectMember(
      orgId,
      proj.id,
      memberUserId,
      "member",
      h.db,
    );
    expect(added).not.toBeNull();
    expect(added!.userId).toBe(memberUserId);

    // Idempotent: adding the same (project, user) again returns the same row.
    const again = await projectService.addProjectMember(
      orgId,
      proj.id,
      memberUserId,
      "member",
      h.db,
    );
    expect(again!.id).toBe(added!.id);

    const members = await projectService.listProjectMembers(orgId, proj.id, h.db);
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe("member@test");

    const removed = await projectService.removeProjectMember(
      orgId,
      proj.id,
      added!.id,
      h.db,
    );
    expect(removed).toBe(true);

    const after = await projectService.listProjectMembers(orgId, proj.id, h.db);
    expect(after).toHaveLength(0);
  });

  it("org B cannot add or list members on org A's project", async () => {
    const a = await makeOrg("mem-a");
    const b = await makeOrg("mem-b");
    const projA = await projectService.createProject(
      a.orgId,
      a.userId,
      { name: "A" },
      h.db,
    );
    const outsider = await h.createUser("outsider@test", "Outsider");

    // add scoped to org B → null, nothing written
    const added = await projectService.addProjectMember(
      b.orgId,
      projA.id,
      outsider,
      "member",
      h.db,
    );
    expect(added).toBeNull();

    const rows = await h.db
      .select({ id: projectMember.id })
      .from(projectMember)
      .where(eq(projectMember.projectId, projA.id));
    expect(rows).toHaveLength(0);

    // list scoped to org B → empty (project not visible)
    const listed = await projectService.listProjectMembers(b.orgId, projA.id, h.db);
    expect(listed).toHaveLength(0);
  });
});

describe("activity feed", () => {
  it("logs activity newest-first and scopes it to the org", async () => {
    const { orgId, userId } = await makeOrg("activity-co");
    const proj = await projectService.createProject(
      orgId,
      userId,
      { name: "Tracked" },
      h.db,
    );

    const first = await projectService.logActivity(
      orgId,
      proj.id,
      userId,
      "created",
      "project",
      proj.id,
      "Tracked",
      h.db,
    );
    expect(first).not.toBeNull();

    const second = await projectService.logActivity(
      orgId,
      proj.id,
      userId,
      "updated",
      "project",
      proj.id,
      "Tracked",
      h.db,
    );
    expect(second).not.toBeNull();

    const feed = await projectService.listActivity(orgId, proj.id, h.db);
    expect(feed).toHaveLength(2);
    // Newest first.
    expect(feed[0].action).toBe("updated");
    expect(feed[1].action).toBe("created");
  });

  it("org B cannot log or read activity on org A's project", async () => {
    const a = await makeOrg("act-a");
    const b = await makeOrg("act-b");
    const projA = await projectService.createProject(
      a.orgId,
      a.userId,
      { name: "A" },
      h.db,
    );

    const logged = await projectService.logActivity(
      b.orgId,
      projA.id,
      b.userId,
      "intrusion",
      null,
      null,
      null,
      h.db,
    );
    expect(logged).toBeNull();

    const feed = await projectService.listActivity(b.orgId, projA.id, h.db);
    expect(feed).toHaveLength(0);
  });
});
