import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeOrgTestDb, type OrgTestDb } from "../helpers/org-test-db";
import { organisation } from "../../lib/db/schema";
import * as projectService from "../../lib/projects/service";
import * as modelService from "../../lib/model-studio/service";
import * as canvas from "../../lib/model-studio/canvas-service";
import { modelCreateSchema } from "../../lib/model-studio/validation";
import { canvasStatePutSchema } from "../../lib/model-studio/canvas-validation";

// ============================================================================
// Canvas-state service tests — empty default, upsert (insert then update),
// per-user + per-layer isolation, and cross-org guard. Last-write-wins (no
// version lock). Runs the real migrations against pglite.
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
  return { orgId: org.id, userId, modelId: model!.id };
}

const POS = { "11111111-1111-4111-8111-111111111111": { x: 10, y: 20 } };

function save(
  orgId: string,
  modelId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  return canvas.saveCanvasState(
    orgId,
    modelId,
    userId,
    canvasStatePutSchema.parse(input),
    h.db,
  );
}

describe("getCanvasState", () => {
  it("returns the empty default before anything is saved", async () => {
    const { orgId, modelId, userId } = await setup("acme");
    const state = await canvas.getCanvasState(orgId, modelId, userId, "logical", h.db);
    expect(state).not.toBeNull();
    expect(state!.nodePositions).toEqual({});
    expect(state!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(state!.notation).toBe("ie");
  });

  it("returns null when the model is not in the org", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    expect(await canvas.getCanvasState(b.orgId, a.modelId, b.userId, "logical", h.db)).toBeNull();
  });
});

describe("saveCanvasState (upsert)", () => {
  it("inserts then updates the same (model,user,layer) row", async () => {
    const { orgId, modelId, userId } = await setup("acme");

    const first = await save(orgId, modelId, userId, {
      layer: "logical",
      nodePositions: POS,
      viewport: { x: 1, y: 2, zoom: 1.5 },
    });
    expect(first!.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });

    const second = await save(orgId, modelId, userId, {
      layer: "logical",
      nodePositions: {},
      viewport: { x: 9, y: 9, zoom: 2 },
      notation: "idef1x",
    });
    expect(second!.viewport).toEqual({ x: 9, y: 9, zoom: 2 });
    expect(second!.notation).toBe("idef1x");

    // Still exactly one row for this layer — it was updated, not duplicated.
    const read = await canvas.getCanvasState(orgId, modelId, userId, "logical", h.db);
    expect(read!.notation).toBe("idef1x");
    expect(read!.nodePositions).toEqual({});
  });

  it("keeps separate state per layer", async () => {
    const { orgId, modelId, userId } = await setup("acme");
    await save(orgId, modelId, userId, {
      layer: "conceptual",
      nodePositions: POS,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    await save(orgId, modelId, userId, {
      layer: "logical",
      nodePositions: {},
      viewport: { x: 5, y: 5, zoom: 1 },
    });
    const conceptual = await canvas.getCanvasState(orgId, modelId, userId, "conceptual", h.db);
    const logical = await canvas.getCanvasState(orgId, modelId, userId, "logical", h.db);
    expect(conceptual!.nodePositions).toEqual(POS);
    expect(logical!.viewport).toEqual({ x: 5, y: 5, zoom: 1 });
  });

  it("returns null saving across orgs", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    const res = await save(b.orgId, a.modelId, b.userId, {
      layer: "logical",
      nodePositions: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(res).toBeNull();
  });
});
