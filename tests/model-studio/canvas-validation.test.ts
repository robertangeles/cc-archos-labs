import { describe, it, expect } from "vitest";
import {
  entityCreateSchema,
  entityUpdateSchema,
  attributeCreateSchema,
  attributeUpdateSchema,
  attributeReorderSchema,
  relationshipCreateSchema,
  relationshipUpdateSchema,
  canvasStatePutSchema,
  canvasStateQuerySchema,
  layerListQuerySchema,
} from "../../lib/model-studio/canvas-validation";

// ============================================================================
// Model Studio canvas validation — pure Zod boundary tests (no DB). Proves the
// enum values match Spresso, the optimistic-lock `version` is enforced on every
// update, the AK-group regex + length bounds hold, and the strict() queries
// reject typos.
// ============================================================================

const UUID = "11111111-1111-4111-8111-111111111111";

describe("entityCreateSchema", () => {
  it("accepts a minimal valid entity and defaults entityType to standard", () => {
    const r = entityCreateSchema.parse({ name: "Customer", layer: "logical" });
    expect(r.entityType).toBe("standard");
    expect(r.name).toBe("Customer");
  });

  it("requires a layer", () => {
    expect(entityCreateSchema.safeParse({ name: "Customer" }).success).toBe(false);
  });

  it("rejects a name longer than 128 chars", () => {
    const r = entityCreateSchema.safeParse({ name: "x".repeat(129), layer: "logical" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown entityType", () => {
    const r = entityCreateSchema.safeParse({ name: "C", layer: "logical", entityType: "weird" });
    expect(r.success).toBe(false);
  });

  it("validates altKeyLabels keys as AKn", () => {
    expect(
      entityCreateSchema.safeParse({ name: "C", layer: "logical", altKeyLabels: { AK1: "NI number" } }).success,
    ).toBe(true);
    expect(
      entityCreateSchema.safeParse({ name: "C", layer: "logical", altKeyLabels: { BK1: "bad" } }).success,
    ).toBe(false);
  });
});

describe("entityUpdateSchema", () => {
  it("requires version", () => {
    expect(entityUpdateSchema.safeParse({ name: "New" }).success).toBe(false);
  });

  it("rejects a version-only body (no actual change)", () => {
    expect(entityUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it("accepts a field plus version", () => {
    expect(entityUpdateSchema.safeParse({ name: "New", version: 3 }).success).toBe(true);
  });

  it("rejects a non-positive version", () => {
    expect(entityUpdateSchema.safeParse({ name: "New", version: 0 }).success).toBe(false);
  });
});

describe("attributeCreateSchema", () => {
  it("defaults the boolean flags", () => {
    const r = attributeCreateSchema.parse({ name: "email" });
    expect(r.isPrimaryKey).toBe(false);
    expect(r.isNullable).toBe(true);
    expect(r.isUnique).toBe(false);
    expect(r.isForeignKey).toBe(false);
  });

  it("accepts a governance classification and rejects an unknown one", () => {
    expect(attributeCreateSchema.safeParse({ name: "ssn", classification: "PII" }).success).toBe(true);
    expect(attributeCreateSchema.safeParse({ name: "ssn", classification: "Secret" }).success).toBe(false);
  });

  it("validates altKeyGroup as AKn", () => {
    expect(attributeCreateSchema.safeParse({ name: "ni", altKeyGroup: "AK2" }).success).toBe(true);
    expect(attributeCreateSchema.safeParse({ name: "ni", altKeyGroup: "X" }).success).toBe(false);
  });
});

describe("attributeUpdateSchema", () => {
  it("requires version and at least one mutable field", () => {
    expect(attributeUpdateSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(attributeUpdateSchema.safeParse({ isUnique: true, version: 1 }).success).toBe(true);
  });
});

describe("attributeReorderSchema", () => {
  it("accepts up/down with version", () => {
    expect(attributeReorderSchema.safeParse({ action: "reorder", direction: "up", version: 1 }).success).toBe(true);
  });

  it("rejects a bad direction and extra keys", () => {
    expect(attributeReorderSchema.safeParse({ action: "reorder", direction: "sideways", version: 1 }).success).toBe(false);
    expect(
      attributeReorderSchema.safeParse({ action: "reorder", direction: "up", version: 1, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("relationshipCreateSchema", () => {
  it("accepts a valid relationship", () => {
    const r = relationshipCreateSchema.parse({
      sourceEntityId: UUID,
      targetEntityId: UUID,
      sourceCardinality: "one",
      targetCardinality: "zero_or_many",
    });
    expect(r.isIdentifying).toBe(false);
  });

  it("rejects an unknown cardinality", () => {
    const r = relationshipCreateSchema.safeParse({
      sourceEntityId: UUID,
      targetEntityId: UUID,
      sourceCardinality: "1..1",
      targetCardinality: "many",
    });
    expect(r.success).toBe(false);
  });

  it("validates waypoints as {x,y} points", () => {
    expect(
      relationshipCreateSchema.safeParse({
        sourceEntityId: UUID,
        targetEntityId: UUID,
        sourceCardinality: "one",
        targetCardinality: "many",
        waypoints: [{ x: 1, y: 2 }],
      }).success,
    ).toBe(true);
    expect(
      relationshipCreateSchema.safeParse({
        sourceEntityId: UUID,
        targetEntityId: UUID,
        sourceCardinality: "one",
        targetCardinality: "many",
        waypoints: [{ x: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("relationshipUpdateSchema", () => {
  it("requires version", () => {
    expect(relationshipUpdateSchema.safeParse({ isIdentifying: true }).success).toBe(false);
    expect(relationshipUpdateSchema.safeParse({ isIdentifying: true, version: 2 }).success).toBe(true);
  });
});

describe("canvasStatePutSchema", () => {
  it("accepts layer + node positions + viewport", () => {
    const r = canvasStatePutSchema.parse({
      layer: "logical",
      nodePositions: { [UUID]: { x: 10, y: 20 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(r.nodePositions[UUID].x).toBe(10);
  });

  it("rejects a malformed node position", () => {
    expect(
      canvasStatePutSchema.safeParse({
        layer: "logical",
        nodePositions: { [UUID]: { x: 10 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      }).success,
    ).toBe(false);
  });

  it("requires a viewport", () => {
    expect(
      canvasStatePutSchema.safeParse({ layer: "logical", nodePositions: {} }).success,
    ).toBe(false);
  });
});

describe("strict query schemas", () => {
  it("canvasStateQuerySchema rejects unknown params", () => {
    expect(canvasStateQuerySchema.safeParse({ layer: "logical" }).success).toBe(true);
    expect(canvasStateQuerySchema.safeParse({ layer: "logical", foo: "bar" }).success).toBe(false);
  });

  it("layerListQuerySchema allows an optional layer and rejects typos", () => {
    expect(layerListQuerySchema.safeParse({}).success).toBe(true);
    expect(layerListQuerySchema.safeParse({ layer: "physical" }).success).toBe(true);
    expect(layerListQuerySchema.safeParse({ layeer: "physical" }).success).toBe(false);
  });
});
