import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as modelService from "../../lib/model-studio/service";
import * as canvas from "../../lib/model-studio/canvas-service";
import { InvalidEndpointError } from "../../lib/model-studio/canvas-service";
import { modelCreateSchema } from "../../lib/model-studio/validation";
import {
  entityCreateSchema,
  relationshipCreateSchema,
} from "../../lib/model-studio/canvas-validation";

// ============================================================================
// Relationship service tests — endpoint validation (reject cross-model edges),
// version lock, cross-org isolation, and cascade when an endpoint entity is
// deleted. Runs the real migrations against pglite.
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
  const mkEntity = (name: string) =>
    canvas.createEntity(
      org.id,
      model!.id,
      userId,
      entityCreateSchema.parse({ name, layer: "logical" }),
      h.db,
    );
  const customer = await mkEntity("Customer");
  const order = await mkEntity("Order");
  return {
    orgId: org.id,
    userId,
    modelId: model!.id,
    customerId: customer!.id,
    orderId: order!.id,
  };
}

function relate(
  orgId: string,
  modelId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  return canvas.createRelationship(
    orgId,
    modelId,
    userId,
    relationshipCreateSchema.parse(input),
    h.db,
  );
}

describe("createRelationship", () => {
  it("creates a relationship between two entities of the model", async () => {
    const s = await setup("acme");
    const rel = await relate(s.orgId, s.modelId, s.userId, {
      sourceEntityId: s.customerId,
      targetEntityId: s.orderId,
      sourceCardinality: "one",
      targetCardinality: "zero_or_many",
      name: "places",
    });
    expect(rel!.sourceEntityId).toBe(s.customerId);
    expect(rel!.targetEntityId).toBe(s.orderId);
    expect(rel!.version).toBe(1);
    expect(rel!.isIdentifying).toBe(false);
  });

  it("rejects an endpoint that belongs to another model", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    await expect(
      relate(a.orgId, a.modelId, a.userId, {
        sourceEntityId: a.customerId,
        targetEntityId: b.orderId, // foreign entity
        sourceCardinality: "one",
        targetCardinality: "many",
      }),
    ).rejects.toBeInstanceOf(InvalidEndpointError);
  });

  it("returns null when the model is not in the org", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    const res = await relate(b.orgId, a.modelId, b.userId, {
      sourceEntityId: a.customerId,
      targetEntityId: a.orderId,
      sourceCardinality: "one",
      targetCardinality: "many",
    });
    expect(res).toBeNull();
  });
});

describe("listRelationships / update / delete", () => {
  it("lists, version-locks updates, and rejects stale writes", async () => {
    const s = await setup("acme");
    const rel = await relate(s.orgId, s.modelId, s.userId, {
      sourceEntityId: s.customerId,
      targetEntityId: s.orderId,
      sourceCardinality: "one",
      targetCardinality: "many",
    });

    const list = await canvas.listRelationships(s.orgId, s.modelId, h.db);
    expect(list).toHaveLength(1);

    const upd = await canvas.updateRelationship(
      s.orgId,
      s.modelId,
      rel!.id,
      { isIdentifying: true, version: 1 },
      h.db,
    );
    expect(upd!.isIdentifying).toBe(true);
    expect(upd!.version).toBe(2);

    await expect(
      canvas.updateRelationship(
        s.orgId,
        s.modelId,
        rel!.id,
        { isIdentifying: false, version: 1 },
        h.db,
      ),
    ).rejects.toMatchObject({ name: "VersionConflictError", serverVersion: 2 });
  });

  it("isolates list/delete across orgs", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    const rel = await relate(a.orgId, a.modelId, a.userId, {
      sourceEntityId: a.customerId,
      targetEntityId: a.orderId,
      sourceCardinality: "one",
      targetCardinality: "many",
    });
    expect(await canvas.listRelationships(b.orgId, a.modelId, h.db)).toBeNull();
    expect(await canvas.deleteRelationship(b.orgId, a.modelId, rel!.id, h.db)).toBe(false);
    expect(await canvas.deleteRelationship(a.orgId, a.modelId, rel!.id, h.db)).toBe(true);
  });

  it("cascades when an endpoint entity is deleted", async () => {
    const s = await setup("acme");
    await relate(s.orgId, s.modelId, s.userId, {
      sourceEntityId: s.customerId,
      targetEntityId: s.orderId,
      sourceCardinality: "one",
      targetCardinality: "many",
    });
    expect(await canvas.listRelationships(s.orgId, s.modelId, h.db)).toHaveLength(1);

    await canvas.deleteEntity(s.orgId, s.modelId, s.customerId, h.db);
    expect(await canvas.listRelationships(s.orgId, s.modelId, h.db)).toHaveLength(0);
  });
});
