import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio entity endpoints (collection +
// single). Service logic is proven in tests/model-studio/entity-service.test.ts;
// these cover the route layer: param/body validation, role gating, status
// mapping (400/401/403/404/409 incl. VERSION_CONFLICT), and the missing-auth
// penetration path. Auth boundary + service are mocked.
// ============================================================================

const {
  requireOrgContextMock,
  listEntitiesMock,
  createEntityMock,
  getEntityMock,
  updateEntityMock,
  deleteEntityMock,
} = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  listEntitiesMock: vi.fn(),
  createEntityMock: vi.fn(),
  getEntityMock: vi.fn(),
  updateEntityMock: vi.fn(),
  deleteEntityMock: vi.fn(),
}));

vi.mock("@/lib/auth/org-context", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/org-context")>();
  return { ...actual, requireOrgContext: requireOrgContextMock };
});

vi.mock("@/lib/model-studio/canvas-service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/model-studio/canvas-service")>();
  return {
    ...actual,
    listEntities: listEntitiesMock,
    createEntity: createEntityMock,
    getEntity: getEntityMock,
    updateEntity: updateEntityMock,
    deleteEntity: deleteEntityMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { ModelConflictError } from "@/lib/model-studio/service";
import { VersionConflictError } from "@/lib/model-studio/canvas-service";
import { GET as listGET, POST } from "./route";
import { GET as oneGET, PATCH, DELETE } from "./[entityId]/route";

const auth = { user: { id: "user-1" } };
const ownerCtx = { orgId: "org-1", role: "owner" as const };
const memberCtx = { orgId: "org-1", role: "member" as const };
const MODEL = "22222222-2222-4222-8222-222222222222";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const base = `https://archoslabs.xyz/api/model-studio/${MODEL}/entities`;

const collParams = (id = MODEL) => ({ params: Promise.resolve({ id }) });
const oneParams = (id = MODEL, entityId = ENTITY) => ({
  params: Promise.resolve({ id, entityId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: ownerCtx });
});

describe("GET /entities", () => {
  it("returns 200 with entities for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    listEntitiesMock.mockResolvedValue([{ id: ENTITY, name: "Customer" }]);
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, entities: [{ id: ENTITY }] });
  });

  it("returns 404 when the model is not in the org", async () => {
    listEntitiesMock.mockResolvedValue(null);
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(404);
  });

  it("returns 400 on a bad layer query", async () => {
    const r = await listGET(new Request(`${base}?layer=bogus`), collParams());
    expect(r.status).toBe(400);
    expect(listEntitiesMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(401);
  });
});

describe("POST /entities", () => {
  const body = (b: unknown) =>
    new Request(base, { method: "POST", body: JSON.stringify(b) });

  it("returns 201 with the created entity for an owner", async () => {
    createEntityMock.mockResolvedValue({ id: ENTITY, name: "Customer", displayId: "E001" });
    const r = await POST(body({ name: "Customer", layer: "logical" }), collParams());
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, entity: { displayId: "E001" } });
  });

  it("returns 403 for a plain member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const r = await POST(body({ name: "Customer", layer: "logical" }), collParams());
    expect(r.status).toBe(403);
    expect(createEntityMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a missing layer", async () => {
    const r = await POST(body({ name: "Customer" }), collParams());
    expect(r.status).toBe(400);
  });

  it("returns 404 when the model is not in the org", async () => {
    createEntityMock.mockResolvedValue(null);
    const r = await POST(body({ name: "Customer", layer: "logical" }), collParams());
    expect(r.status).toBe(404);
  });

  it("returns 409 on a duplicate name", async () => {
    createEntityMock.mockRejectedValue(new ModelConflictError("dupe"));
    const r = await POST(body({ name: "Customer", layer: "logical" }), collParams());
    expect(r.status).toBe(409);
  });
});

describe("PATCH /entities/:entityId", () => {
  const body = (b: unknown) =>
    new Request(`${base}/${ENTITY}`, { method: "PATCH", body: JSON.stringify(b) });

  it("returns 200 with the updated entity", async () => {
    updateEntityMock.mockResolvedValue({ id: ENTITY, name: "Client", version: 2 });
    const r = await PATCH(body({ name: "Client", version: 1 }), oneParams());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, entity: { version: 2 } });
  });

  it("returns 403 for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const r = await PATCH(body({ name: "Client", version: 1 }), oneParams());
    expect(r.status).toBe(403);
  });

  it("returns 400 when version is missing", async () => {
    const r = await PATCH(body({ name: "Client" }), oneParams());
    expect(r.status).toBe(400);
    expect(updateEntityMock).not.toHaveBeenCalled();
  });

  it("returns 409 VERSION_CONFLICT with the server version on a stale write", async () => {
    updateEntityMock.mockRejectedValue(new VersionConflictError(7));
    const r = await PATCH(body({ name: "Client", version: 1 }), oneParams());
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "VERSION_CONFLICT", serverVersion: 7 });
  });

  it("returns 404 when the entity is not in the org", async () => {
    updateEntityMock.mockResolvedValue(null);
    const r = await PATCH(body({ name: "Client", version: 1 }), oneParams());
    expect(r.status).toBe(404);
  });
});

describe("GET/DELETE /entities/:entityId", () => {
  it("GET returns 404 when missing", async () => {
    getEntityMock.mockResolvedValue(null);
    const r = await oneGET(new Request(`${base}/${ENTITY}`), oneParams());
    expect(r.status).toBe(404);
  });

  it("DELETE returns 200 when removed, 403 for a member", async () => {
    deleteEntityMock.mockResolvedValue(true);
    const ok = await DELETE(
      new Request(`${base}/${ENTITY}`, { method: "DELETE" }),
      oneParams(),
    );
    expect(ok.status).toBe(200);

    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const forbidden = await DELETE(
      new Request(`${base}/${ENTITY}`, { method: "DELETE" }),
      oneParams(),
    );
    expect(forbidden.status).toBe(403);
  });
});
