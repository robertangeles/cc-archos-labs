import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as modelService from "../../lib/model-studio/service";
import { ModelConflictError } from "../../lib/model-studio/service";
import * as canvas from "../../lib/model-studio/canvas-service";
import { modelCreateSchema } from "../../lib/model-studio/validation";
import {
  entityCreateSchema,
  attributeCreateSchema,
} from "../../lib/model-studio/canvas-validation";

// ============================================================================
// Attribute service tests — ordinal append, atomic up/down reorder, version
// lock, (entity, name) uniqueness, cross-org isolation, batch model load, and
// cascade-on-entity-delete. Runs the real migrations against pglite.
// ============================================================================

let h: OrgTestDb;

beforeEach(async () => {
  h = await makeOrgTestDb();
});

afterEach(async () => {
  await h.close();
});

async function setup(slug: string) {
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
  const entity = await canvas.createEntity(
    org.id,
    model!.id,
    userId,
    entityCreateSchema.parse({ name: "Customer", layer: "logical" }),
    h.db,
  );
  return { orgId: org.id, userId, modelId: model!.id, entityId: entity!.id };
}

function addAttr(
  orgId: string,
  modelId: string,
  entityId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  return canvas.createAttribute(
    orgId,
    modelId,
    entityId,
    userId,
    attributeCreateSchema.parse(input),
    h.db,
  );
}

describe("createAttribute", () => {
  it("appends ordinal positions and starts at version 1", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    const a = await addAttr(orgId, modelId, entityId, userId, { name: "id", isPrimaryKey: true });
    const b = await addAttr(orgId, modelId, entityId, userId, { name: "email" });
    expect(a!.ordinalPosition).toBe(1);
    expect(b!.ordinalPosition).toBe(2);
    expect(a!.version).toBe(1);
    expect(a!.isPrimaryKey).toBe(true);
    expect(b!.isNullable).toBe(true);
  });

  it("rejects a duplicate name on the same entity", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    await addAttr(orgId, modelId, entityId, userId, { name: "email" });
    await expect(
      addAttr(orgId, modelId, entityId, userId, { name: "email" }),
    ).rejects.toBeInstanceOf(ModelConflictError);
  });

  it("returns null when the entity is not in the org", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    const res = await addAttr(b.orgId, a.modelId, a.entityId, b.userId, { name: "x" });
    expect(res).toBeNull();
  });
});

describe("listAttributes / listModelAttributes", () => {
  it("lists by ordinal and batch-loads the whole model", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    await addAttr(orgId, modelId, entityId, userId, { name: "id" });
    await addAttr(orgId, modelId, entityId, userId, { name: "email" });

    const list = await canvas.listAttributes(orgId, modelId, entityId, h.db);
    expect(list!.map((a) => a.name)).toEqual(["id", "email"]);

    const all = await canvas.listModelAttributes(orgId, modelId, h.db);
    expect(all).toHaveLength(2);
  });

  it("returns null listing across orgs", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    expect(await canvas.listAttributes(b.orgId, a.modelId, a.entityId, h.db)).toBeNull();
    expect(await canvas.listModelAttributes(b.orgId, a.modelId, h.db)).toBeNull();
  });
});

describe("updateAttribute (optimistic lock)", () => {
  it("bumps version and rejects a stale write", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    const attr = await addAttr(orgId, modelId, entityId, userId, { name: "email" });

    const upd = await canvas.updateAttribute(
      orgId,
      modelId,
      entityId,
      attr!.id,
      { isUnique: true, version: 1 },
      h.db,
    );
    expect(upd!.isUnique).toBe(true);
    expect(upd!.version).toBe(2);

    await expect(
      canvas.updateAttribute(
        orgId,
        modelId,
        entityId,
        attr!.id,
        { isUnique: false, version: 1 },
        h.db,
      ),
    ).rejects.toMatchObject({ name: "VersionConflictError", serverVersion: 2 });
  });
});

describe("reorderAttribute", () => {
  it("swaps ordinals with the adjacent sibling", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    const a = await addAttr(orgId, modelId, entityId, userId, { name: "id" });
    const b = await addAttr(orgId, modelId, entityId, userId, { name: "email" });
    expect(a!.ordinalPosition).toBe(1);
    expect(b!.ordinalPosition).toBe(2);

    // Move "email" up — it should swap to ordinal 1.
    const moved = await canvas.reorderAttribute(
      orgId,
      modelId,
      entityId,
      b!.id,
      "up",
      b!.version,
      h.db,
    );
    expect(moved!.ordinalPosition).toBe(1);

    const list = await canvas.listAttributes(orgId, modelId, entityId, h.db);
    expect(list!.map((x) => x.name)).toEqual(["email", "id"]);
  });

  it("is a no-op at the edge", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    const a = await addAttr(orgId, modelId, entityId, userId, { name: "id" });
    const moved = await canvas.reorderAttribute(
      orgId,
      modelId,
      entityId,
      a!.id,
      "up",
      a!.version,
      h.db,
    );
    expect(moved!.ordinalPosition).toBe(1);
  });

  it("rejects a stale version", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    const a = await addAttr(orgId, modelId, entityId, userId, { name: "id" });
    await addAttr(orgId, modelId, entityId, userId, { name: "email" });
    await expect(
      canvas.reorderAttribute(orgId, modelId, entityId, a!.id, "down", 99, h.db),
    ).rejects.toMatchObject({ name: "VersionConflictError" });
  });
});

describe("deleteAttribute + cascade", () => {
  it("deletes an attribute and refuses across orgs", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    const attr = await addAttr(a.orgId, a.modelId, a.entityId, a.userId, { name: "email" });
    expect(await canvas.deleteAttribute(b.orgId, a.modelId, a.entityId, attr!.id, h.db)).toBe(false);
    expect(await canvas.deleteAttribute(a.orgId, a.modelId, a.entityId, attr!.id, h.db)).toBe(true);
  });

  it("cascades attributes when the entity is deleted", async () => {
    const { orgId, modelId, entityId, userId } = await setup("acme");
    await addAttr(orgId, modelId, entityId, userId, { name: "id" });
    await addAttr(orgId, modelId, entityId, userId, { name: "email" });
    expect(await canvas.listModelAttributes(orgId, modelId, h.db)).toHaveLength(2);

    await canvas.deleteEntity(orgId, modelId, entityId, h.db);
    expect(await canvas.listModelAttributes(orgId, modelId, h.db)).toHaveLength(0);
  });
});
