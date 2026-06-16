import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as modelService from "../../lib/model-studio/service";
import { ModelConflictError } from "../../lib/model-studio/service";
import * as canvas from "../../lib/model-studio/canvas-service";
import { VersionConflictError } from "../../lib/model-studio/canvas-service";
import { modelCreateSchema } from "../../lib/model-studio/validation";
import { entityCreateSchema } from "../../lib/model-studio/canvas-validation";

// ============================================================================
// Entity service tests — run the real migrations (incl. 0028) against pglite
// and prove: monotonic display ids, version bump + stale-write conflict,
// (model, name) uniqueness, cross-org isolation, and cascade-friendly delete.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

async function makeOrgWithModel(slug: string): Promise<{
  orgId: string;
  userId: string;
  modelId: string;
}> {
  const userId = await h.createUser(`${slug}@test`, slug);
  const [org] = await h.db
    .insert(organisation)
    .values({ name: slug, slug, joinKey: `key-${slug}`, ownerId: userId })
    .returning({ id: organisation.id });
  const proj = await projectService.createProject(
    org.id,
    userId,
    { name: `${slug} project` },
    h.db,
  );
  const model = await modelService.createModel(
    org.id,
    userId,
    modelCreateSchema.parse({ name: `${slug} model`, projectId: proj!.id }),
    h.db,
  );
  return { orgId: org.id, userId, modelId: model!.id };
}

function create(
  orgId: string,
  modelId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  return canvas.createEntity(
    orgId,
    modelId,
    userId,
    entityCreateSchema.parse(input),
    h.db,
  );
}

describe("createEntity", () => {
  it("assigns monotonic display ids and starts at version 1", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");

    const a = await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });
    const b = await create(orgId, modelId, userId, { name: "Order", layer: "logical" });
    const c = await create(orgId, modelId, userId, { name: "Product", layer: "logical" });

    expect(a!.displayId).toBe("E001");
    expect(b!.displayId).toBe("E002");
    expect(c!.displayId).toBe("E003");
    expect(a!.version).toBe(1);
    expect(a!.entityType).toBe("standard");
    expect(a!.createdBy).toBe(userId);
  });

  it("rejects a duplicate name in the same model with ModelConflictError", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });
    await expect(
      create(orgId, modelId, userId, { name: "Customer", layer: "logical" }),
    ).rejects.toBeInstanceOf(ModelConflictError);
  });

  it("returns null when the model is not in the caller's org", async () => {
    const a = await makeOrgWithModel("acme");
    const b = await makeOrgWithModel("beta");
    // beta's org trying to create inside acme's model.
    const res = await create(b.orgId, a.modelId, b.userId, {
      name: "Sneaky",
      layer: "logical",
    });
    expect(res).toBeNull();
  });
});

describe("listEntities / getEntity", () => {
  it("lists by display id order and filters by layer", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    await create(orgId, modelId, userId, { name: "Concept", layer: "conceptual" });
    await create(orgId, modelId, userId, { name: "Logic", layer: "logical" });

    const all = await canvas.listEntities(orgId, modelId, undefined, h.db);
    expect(all).toHaveLength(2);
    expect(all![0].displayId).toBe("E001");

    const logical = await canvas.listEntities(orgId, modelId, "logical", h.db);
    expect(logical).toHaveLength(1);
    expect(logical![0].name).toBe("Logic");
  });

  it("returns null from list when the model is not in the org", async () => {
    const a = await makeOrgWithModel("acme");
    const b = await makeOrgWithModel("beta");
    expect(await canvas.listEntities(b.orgId, a.modelId, undefined, h.db)).toBeNull();
  });

  it("does not get an entity across orgs", async () => {
    const a = await makeOrgWithModel("acme");
    const b = await makeOrgWithModel("beta");
    const e = await create(a.orgId, a.modelId, a.userId, { name: "Customer", layer: "logical" });
    expect(await canvas.getEntity(a.orgId, a.modelId, e!.id, h.db)).not.toBeNull();
    expect(await canvas.getEntity(b.orgId, a.modelId, e!.id, h.db)).toBeNull();
  });
});

describe("updateEntity (optimistic lock)", () => {
  it("bumps version on a successful update", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    const e = await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });

    const updated = await canvas.updateEntity(
      orgId,
      modelId,
      e!.id,
      { name: "Client", version: 1 },
      h.db,
    );
    expect(updated!.name).toBe("Client");
    expect(updated!.version).toBe(2);
  });

  it("throws VersionConflictError with the server version on a stale write", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    const e = await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });
    // First update wins (1 → 2).
    await canvas.updateEntity(orgId, modelId, e!.id, { name: "Client", version: 1 }, h.db);
    // Second update still thinks it's on version 1 → conflict.
    await expect(
      canvas.updateEntity(orgId, modelId, e!.id, { name: "Customer", version: 1 }, h.db),
    ).rejects.toMatchObject({ name: "VersionConflictError", serverVersion: 2 });
  });

  it("returns null when updating an entity outside the org", async () => {
    const a = await makeOrgWithModel("acme");
    const b = await makeOrgWithModel("beta");
    const e = await create(a.orgId, a.modelId, a.userId, { name: "Customer", layer: "logical" });
    const res = await canvas.updateEntity(
      b.orgId,
      a.modelId,
      e!.id,
      { name: "Hacked", version: 1 },
      h.db,
    );
    expect(res).toBeNull();
  });

  it("surfaces a rename collision as ModelConflictError", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });
    const order = await create(orgId, modelId, userId, { name: "Order", layer: "logical" });
    await expect(
      canvas.updateEntity(orgId, modelId, order!.id, { name: "Customer", version: 1 }, h.db),
    ).rejects.toBeInstanceOf(ModelConflictError);
  });
});

describe("deleteEntity", () => {
  it("removes an entity in the org and returns true", async () => {
    const { orgId, userId, modelId } = await makeOrgWithModel("acme");
    const e = await create(orgId, modelId, userId, { name: "Customer", layer: "logical" });
    expect(await canvas.deleteEntity(orgId, modelId, e!.id, h.db)).toBe(true);
    expect(await canvas.getEntity(orgId, modelId, e!.id, h.db)).toBeNull();
  });

  it("refuses to delete across orgs", async () => {
    const a = await makeOrgWithModel("acme");
    const b = await makeOrgWithModel("beta");
    const e = await create(a.orgId, a.modelId, a.userId, { name: "Customer", layer: "logical" });
    expect(await canvas.deleteEntity(b.orgId, a.modelId, e!.id, h.db)).toBe(false);
    expect(await canvas.getEntity(a.orgId, a.modelId, e!.id, h.db)).not.toBeNull();
  });
});
