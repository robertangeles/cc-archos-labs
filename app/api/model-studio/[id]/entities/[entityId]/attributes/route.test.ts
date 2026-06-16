import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio attribute endpoints (collection +
// single, incl. the reorder discriminated PATCH). Service logic is proven in
// tests/model-studio/attribute-service.test.ts; these cover the route layer.
// Auth boundary + service are mocked.
// ============================================================================

const {
  requireOrgContextMock,
  listAttributesMock,
  createAttributeMock,
  updateAttributeMock,
  reorderAttributeMock,
  deleteAttributeMock,
} = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  listAttributesMock: vi.fn(),
  createAttributeMock: vi.fn(),
  updateAttributeMock: vi.fn(),
  reorderAttributeMock: vi.fn(),
  deleteAttributeMock: vi.fn(),
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
    listAttributes: listAttributesMock,
    createAttribute: createAttributeMock,
    updateAttribute: updateAttributeMock,
    reorderAttribute: reorderAttributeMock,
    deleteAttribute: deleteAttributeMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { ModelConflictError } from "@/lib/model-studio/service";
import { VersionConflictError } from "@/lib/model-studio/canvas-service";
import { GET as listGET, POST } from "./route";
import { PATCH, DELETE } from "./[attributeId]/route";

const auth = { user: { id: "user-1" } };
const ownerCtx = { orgId: "org-1", role: "owner" as const };
const memberCtx = { orgId: "org-1", role: "member" as const };
const MODEL = "22222222-2222-4222-8222-222222222222";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const ATTR = "55555555-5555-4555-8555-555555555555";
const base = `https://archoslabs.xyz/api/model-studio/${MODEL}/entities/${ENTITY}/attributes`;

const collParams = () => ({ params: Promise.resolve({ id: MODEL, entityId: ENTITY }) });
const oneParams = () => ({
  params: Promise.resolve({ id: MODEL, entityId: ENTITY, attributeId: ATTR }),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: ownerCtx });
});

describe("GET/POST /attributes", () => {
  it("GET returns 200 list for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    listAttributesMock.mockResolvedValue([{ id: ATTR, name: "email" }]);
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, attributes: [{ id: ATTR }] });
  });

  it("GET returns 404 when the entity is not in the org", async () => {
    listAttributesMock.mockResolvedValue(null);
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(404);
  });

  it("GET returns 401 unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(401);
  });

  const post = (b: unknown) =>
    new Request(base, { method: "POST", body: JSON.stringify(b) });

  it("POST returns 201 for an owner", async () => {
    createAttributeMock.mockResolvedValue({ id: ATTR, name: "email", ordinalPosition: 1 });
    const r = await POST(post({ name: "email" }), collParams());
    expect(r.status).toBe(201);
  });

  it("POST returns 403 for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const r = await POST(post({ name: "email" }), collParams());
    expect(r.status).toBe(403);
  });

  it("POST returns 409 on duplicate name", async () => {
    createAttributeMock.mockRejectedValue(new ModelConflictError("dupe"));
    const r = await POST(post({ name: "email" }), collParams());
    expect(r.status).toBe(409);
  });
});

describe("PATCH /attributes/:attributeId — update", () => {
  const patch = (b: unknown) =>
    new Request(`${base}/${ATTR}`, { method: "PATCH", body: JSON.stringify(b) });

  it("returns 200 and bumps version", async () => {
    updateAttributeMock.mockResolvedValue({ id: ATTR, isUnique: true, version: 2 });
    const r = await patch({ isUnique: true, version: 1 });
    const res = await PATCH(r, oneParams());
    expect(res.status).toBe(200);
    expect(reorderAttributeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when version is missing", async () => {
    const res = await PATCH(patch({ isUnique: true }), oneParams());
    expect(res.status).toBe(400);
  });

  it("returns 409 VERSION_CONFLICT on a stale write", async () => {
    updateAttributeMock.mockRejectedValue(new VersionConflictError(4));
    const res = await PATCH(patch({ isUnique: true, version: 1 }), oneParams());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "VERSION_CONFLICT", serverVersion: 4 });
  });
});

describe("PATCH /attributes/:attributeId — reorder", () => {
  const reorder = (b: unknown) =>
    new Request(`${base}/${ATTR}`, { method: "PATCH", body: JSON.stringify(b) });

  it("routes a reorder body to reorderAttribute", async () => {
    reorderAttributeMock.mockResolvedValue({ id: ATTR, ordinalPosition: 1 });
    const res = await PATCH(
      reorder({ action: "reorder", direction: "up", version: 2 }),
      oneParams(),
    );
    expect(res.status).toBe(200);
    expect(reorderAttributeMock).toHaveBeenCalledWith(
      "org-1",
      MODEL,
      ENTITY,
      ATTR,
      "up",
      2,
    );
    expect(updateAttributeMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a bad direction", async () => {
    const res = await PATCH(
      reorder({ action: "reorder", direction: "sideways", version: 2 }),
      oneParams(),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /attributes/:attributeId", () => {
  it("returns 200 when removed, 404 when missing", async () => {
    deleteAttributeMock.mockResolvedValue(true);
    const ok = await DELETE(
      new Request(`${base}/${ATTR}`, { method: "DELETE" }),
      oneParams(),
    );
    expect(ok.status).toBe(200);

    deleteAttributeMock.mockResolvedValue(false);
    const missing = await DELETE(
      new Request(`${base}/${ATTR}`, { method: "DELETE" }),
      oneParams(),
    );
    expect(missing.status).toBe(404);
  });
});
