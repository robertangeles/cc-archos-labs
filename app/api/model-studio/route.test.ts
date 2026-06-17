import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio model collection endpoints.
//
// The service logic (org-scoping, CRUD, conflict, cross-org isolation) is
// proven against real Postgres in tests/model-studio/model-service.test.ts.
// These tests cover the NEW route-layer logic: input validation, the
// HTTP status mapping (400/401/404/409/201/200), and the penetration path
// (missing auth → 401). The auth boundary and service are mocked so the
// route's wiring is asserted in isolation.
// ============================================================================

const { requireOrgContextMock, listModelsMock, createModelMock } = vi.hoisted(
  () => ({
    requireOrgContextMock: vi.fn(),
    listModelsMock: vi.fn(),
    createModelMock: vi.fn(),
  }),
);

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
    listModels: listModelsMock,
    createModel: createModelMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { ModelConflictError } from "@/lib/model-studio/service";
import { GET, POST } from "./route";

const ctx = { orgId: "org-1", role: "member" as const };
const auth = { user: { id: "user-1" } };
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx });
});

function jsonRequest(body: unknown) {
  return new Request("https://archoslabs.xyz/api/model-studio", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/model-studio", () => {
  it("returns 200 with models + total for a member", async () => {
    listModelsMock.mockResolvedValue({ models: [{ id: "m1" }], total: 1 });
    const r = await GET(new Request("https://archoslabs.xyz/api/model-studio"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, models: [{ id: "m1" }], total: 1 });
  });

  it("threads validated query params through to the service", async () => {
    listModelsMock.mockResolvedValue({ models: [], total: 0 });
    await GET(
      new Request(
        `https://archoslabs.xyz/api/model-studio?projectId=${PROJECT_ID}&includeArchived=true&limit=10&offset=5`,
      ),
    );
    expect(listModelsMock).toHaveBeenCalledWith("org-1", {
      projectId: PROJECT_ID,
      includeArchived: true,
      limit: 10,
      offset: 5,
    });
  });

  it("returns 400 on an invalid query param (limit > 100)", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/model-studio?limit=9999"),
    );
    expect(r.status).toBe(400);
    expect(listModelsMock).not.toHaveBeenCalled();
  });

  it("returns 400 on an unknown query param (strict schema)", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/model-studio?foo=bar"),
    );
    expect(r.status).toBe(400);
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await GET(new Request("https://archoslabs.xyz/api/model-studio"));
    expect(r.status).toBe(401);
    expect(listModelsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/model-studio", () => {
  it("returns 201 with the created model", async () => {
    createModelMock.mockResolvedValue({ id: "m1", name: "Orders" });
    const r = await POST(jsonRequest({ name: "Orders", projectId: PROJECT_ID }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, model: { id: "m1" } });
  });

  it("returns 400 on an invalid body (missing name)", async () => {
    const r = await POST(jsonRequest({ projectId: PROJECT_ID }));
    expect(r.status).toBe(400);
    expect(createModelMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the project is outside the org (service returns null)", async () => {
    createModelMock.mockResolvedValue(null);
    const r = await POST(jsonRequest({ name: "Orders", projectId: PROJECT_ID }));
    expect(r.status).toBe(404);
  });

  it("returns 409 on a name conflict", async () => {
    createModelMock.mockRejectedValue(new ModelConflictError("duplicate"));
    const r = await POST(jsonRequest({ name: "Orders", projectId: PROJECT_ID }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ ok: false, error: "duplicate" });
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await POST(jsonRequest({ name: "Orders", projectId: PROJECT_ID }));
    expect(r.status).toBe(401);
    expect(createModelMock).not.toHaveBeenCalled();
  });
});
