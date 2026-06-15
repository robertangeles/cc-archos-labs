import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation, dataModel } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as modelService from "../../lib/model-studio/service";
import { ModelConflictError } from "../../lib/model-studio/service";
import { modelCreateSchema } from "../../lib/model-studio/validation";

// ============================================================================
// Model Studio service tests — run the real migration (0027) against an
// ephemeral Postgres (pglite) and prove: model CRUD, the (project, owner, name)
// uniqueness conflict, archived filtering, and the cross-org isolation
// guarantee (org B can never list/get/update/delete a model that lives under
// org A's project). Every service call passes the harness db as dbArg.
//
// Create inputs are parsed through modelCreateSchema (as the route does) so the
// service receives a fully-defaulted DTO and the schema is exercised end-to-end.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

/** Create an org owned by a fresh user. Returns { orgId, userId }. */
async function makeOrg(
  slug: string,
): Promise<{ orgId: string; userId: string }> {
  const userId = await h.createUser(`${slug}@test`, slug);
  const [org] = await h.db
    .insert(organisation)
    .values({ name: slug, slug, joinKey: `key-${slug}`, ownerId: userId })
    .returning({ id: organisation.id });
  return { orgId: org.id, userId };
}

/** Create an org + a project inside it. Returns ids plus the owner user id. */
async function makeOrgWithProject(slug: string): Promise<{
  orgId: string;
  userId: string;
  projectId: string;
}> {
  const { orgId, userId } = await makeOrg(slug);
  const proj = await projectService.createProject(
    orgId,
    userId,
    { name: `${slug} project` },
    h.db,
  );
  return { orgId, userId, projectId: proj!.id };
}

/** Create a model through the same validation the route applies. */
function seedModel(
  orgId: string,
  ownerId: string,
  name: string,
  projectId: string,
) {
  return modelService.createModel(
    orgId,
    ownerId,
    modelCreateSchema.parse({ name, projectId }),
    h.db,
  );
}

/** The list query after Zod parsing (includeArchived defaults to false). */
const LIST_ALL = { limit: 50, offset: 0, includeArchived: false };

describe("model CRUD", () => {
  it("creates, lists, and gets a model scoped to its org", async () => {
    const { orgId, userId, projectId } = await makeOrgWithProject("acme");

    const created = await seedModel(orgId, userId, "Customer Domain", projectId);
    expect(created).not.toBeNull();
    expect(created!.name).toBe("Customer Domain");
    expect(created!.projectId).toBe(projectId);
    expect(created!.ownerId).toBe(userId);
    expect(created!.activeLayer).toBe("conceptual");
    expect(created!.notation).toBe("ie");
    expect(created!.originDirection).toBe("greenfield");
    // Hierarchy enrichment is hydrated through the join.
    expect(created!.projectName).toBe("acme project");
    expect(created!.ownerName).toBe("acme");

    const { models, total } = await modelService.listModels(
      orgId,
      LIST_ALL,
      h.db,
    );
    expect(total).toBe(1);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe(created!.id);

    const fetched = await modelService.getModel(orgId, created!.id, h.db);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Customer Domain");
  });

  it("updates a model's fields", async () => {
    const { orgId, userId, projectId } = await makeOrgWithProject("globex");
    const created = await seedModel(orgId, userId, "Initial", projectId);

    const updated = await modelService.updateModel(
      orgId,
      created!.id,
      { name: "Renamed", notation: "idef1x", activeLayer: "logical" },
      h.db,
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.notation).toBe("idef1x");
    expect(updated!.activeLayer).toBe("logical");
  });

  it("deletes a model and reports the result as a boolean", async () => {
    const { orgId, userId, projectId } = await makeOrgWithProject("initech");
    const created = await seedModel(orgId, userId, "To delete", projectId);

    const removed = await modelService.deleteModel(orgId, created!.id, h.db);
    expect(removed).toBe(true);

    const gone = await modelService.getModel(orgId, created!.id, h.db);
    expect(gone).toBeNull();

    // Deleting again is a no-op false (already gone).
    const again = await modelService.deleteModel(orgId, created!.id, h.db);
    expect(again).toBe(false);
  });

  it("refuses to create a model in a project outside the org", async () => {
    const a = await makeOrgWithProject("create-a");
    const b = await makeOrg("create-b");

    // Org B tries to plant a model in org A's project → null, nothing written.
    const planted = await seedModel(b.orgId, b.userId, "Trojan", a.projectId);
    expect(planted).toBeNull();

    const rows = await h.db
      .select({ id: dataModel.id })
      .from(dataModel)
      .where(eq(dataModel.projectId, a.projectId));
    expect(rows).toHaveLength(0);
  });
});

describe("uniqueness", () => {
  it("throws ModelConflictError on a duplicate (project, owner, name)", async () => {
    const { orgId, userId, projectId } = await makeOrgWithProject("dupes");
    await seedModel(orgId, userId, "Sales", projectId);

    await expect(
      seedModel(orgId, userId, "Sales", projectId),
    ).rejects.toBeInstanceOf(ModelConflictError);
  });
});

describe("archived filtering", () => {
  it("hides archived models unless includeArchived is set", async () => {
    const { orgId, userId, projectId } = await makeOrgWithProject("archive-co");
    const keep = await seedModel(orgId, userId, "Active", projectId);
    const old = await seedModel(orgId, userId, "Retired", projectId);
    await modelService.updateModel(
      orgId,
      old!.id,
      { archivedAt: new Date() },
      h.db,
    );

    const visible = await modelService.listModels(orgId, LIST_ALL, h.db);
    expect(visible.total).toBe(1);
    expect(visible.models[0].id).toBe(keep!.id);

    const all = await modelService.listModels(
      orgId,
      { ...LIST_ALL, includeArchived: true },
      h.db,
    );
    expect(all.total).toBe(2);
  });
});

describe("cross-org isolation (model)", () => {
  it("org B cannot get, update, or delete a model under org A's project", async () => {
    const a = await makeOrgWithProject("org-a");
    const b = await makeOrg("org-b");

    const modelA = await seedModel(a.orgId, a.userId, "A-secret", a.projectId);

    // get scoped to org B → null
    const leaked = await modelService.getModel(b.orgId, modelA!.id, h.db);
    expect(leaked).toBeNull();

    // update scoped to org B → null, and the row is untouched
    const updated = await modelService.updateModel(
      b.orgId,
      modelA!.id,
      { name: "hijacked" },
      h.db,
    );
    expect(updated).toBeNull();
    const stillA = await modelService.getModel(a.orgId, modelA!.id, h.db);
    expect(stillA!.name).toBe("A-secret");

    // delete scoped to org B → false, and the row survives
    const removed = await modelService.deleteModel(b.orgId, modelA!.id, h.db);
    expect(removed).toBe(false);
    const survivor = await modelService.getModel(a.orgId, modelA!.id, h.db);
    expect(survivor).not.toBeNull();
  });

  it("listModels only returns models under the caller org's projects", async () => {
    const a = await makeOrgWithProject("list-a");
    const b = await makeOrgWithProject("list-b");
    await seedModel(a.orgId, a.userId, "A1", a.projectId);
    await seedModel(a.orgId, a.userId, "A2", a.projectId);
    await seedModel(b.orgId, b.userId, "B1", b.projectId);

    const aList = await modelService.listModels(a.orgId, LIST_ALL, h.db);
    const bList = await modelService.listModels(b.orgId, LIST_ALL, h.db);
    expect(aList.total).toBe(2);
    expect(bList.total).toBe(1);
    expect(bList.models[0].name).toBe("B1");
  });
});
