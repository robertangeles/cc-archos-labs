import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the single-model Model Studio endpoints.
//
// Service logic is proven in tests/model-studio/model-service.test.ts. These
// tests cover the route layer: param validation, role gating on mutations
// (owner/admin only), status mapping (400/401/403/404/409), and the missing-
// auth penetration path. Auth boundary + service are mocked.
// ============================================================================

const {
  requireOrgContextMock,
  getModelMock,
  updateModelMock,
  deleteModelMock,
} = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  getModelMock: vi.fn(),
  updateModelMock: vi.fn(),
  deleteModelMock: vi.fn(),
}));

vi.mock("@/lib/auth/org-context", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/auth/org-context")>();
  return { ...actual, requireOrgContext: requireOrgContextMock };
});

vi.mock("@/lib/model-studio/service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/model-studio/service")>();
  return {
    ...actual,
    getModel: getModelMock,
    updateModel: updateModelMock,
    deleteModel: deleteModelMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { ModelConflictError } from "@/lib/model-studio/service";
import { GET, PATCH, DELETE } from "./route";

const auth = { user: { id: "user-1" } };
const MODEL_ID = "22222222-2222-4222-8222-222222222222";
const ownerCtx = { orgId: "org-1", role: "owner" as const };
const memberCtx = { orgId: "org-1", role: "member" as const };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: ownerCtx });
});

describe("GET /api/model-studio/:id", () => {
  it("returns 200 with the model for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    getModelMock.mockResolvedValue({ id: MODEL_ID, name: "Orders" });
    const r = await GET(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`),
      params(MODEL_ID),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, model: { id: MODEL_ID } });
  });

  it("returns 404 when the model is not in the org", async () => {
    getModelMock.mockResolvedValue(null);
    const r = await GET(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`),
      params(MODEL_ID),
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 on a non-uuid id", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/model-studio/not-a-uuid"),
      params("not-a-uuid"),
    );
    expect(r.status).toBe(400);
    expect(getModelMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await GET(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`),
      params(MODEL_ID),
    );
    expect(r.status).toBe(401);
  });
});

describe("PATCH /api/model-studio/:id", () => {
  it("returns 200 with the updated model for an owner", async () => {
    updateModelMock.mockResolvedValue({ id: MODEL_ID, name: "Renamed" });
    const r = await PATCH(patchRequest({ name: "Renamed" }), params(MODEL_ID));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, model: { name: "Renamed" } });
  });

  it("returns 403 for a plain member (role gate)", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const r = await PATCH(patchRequest({ name: "Renamed" }), params(MODEL_ID));
    expect(r.status).toBe(403);
    expect(updateModelMock).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid field (bad notation enum)", async () => {
    const r = await PATCH(patchRequest({ notation: "bogus" }), params(MODEL_ID));
    expect(r.status).toBe(400);
    expect(updateModelMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the model is not in the org", async () => {
    updateModelMock.mockResolvedValue(null);
    const r = await PATCH(patchRequest({ name: "Renamed" }), params(MODEL_ID));
    expect(r.status).toBe(404);
  });

  it("returns 409 on a name conflict", async () => {
    updateModelMock.mockRejectedValue(new ModelConflictError("duplicate"));
    const r = await PATCH(patchRequest({ name: "Renamed" }), params(MODEL_ID));
    expect(r.status).toBe(409);
  });
});

describe("DELETE /api/model-studio/:id", () => {
  it("returns 200 when a row was removed", async () => {
    deleteModelMock.mockResolvedValue(true);
    const r = await DELETE(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`, {
        method: "DELETE",
      }),
      params(MODEL_ID),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it("returns 403 for a plain member (role gate)", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    const r = await DELETE(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`, {
        method: "DELETE",
      }),
      params(MODEL_ID),
    );
    expect(r.status).toBe(403);
    expect(deleteModelMock).not.toHaveBeenCalled();
  });

  it("returns 404 when nothing was removed", async () => {
    deleteModelMock.mockResolvedValue(false);
    const r = await DELETE(
      new Request(`https://archoslabs.xyz/api/model-studio/${MODEL_ID}`, {
        method: "DELETE",
      }),
      params(MODEL_ID),
    );
    expect(r.status).toBe(404);
  });
});
