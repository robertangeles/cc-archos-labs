import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio feature-flag endpoints.
//
// The flag persistence (site_setting read/write, default, cache) is a thin
// wrapper over Drizzle; these tests cover the NEW route-layer logic: the
// HTTP status mapping (200/400/401/403), the owner|admin gate on PUT, and the
// penetration paths (missing auth → 401, insufficient role → 403). The auth
// boundary and flag service are mocked so the route's wiring is asserted in
// isolation.
// ============================================================================

const {
  requireOrgContextMock,
  isModelStudioEnabledMock,
  setModelStudioEnabledMock,
} = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  isModelStudioEnabledMock: vi.fn(),
  setModelStudioEnabledMock: vi.fn(),
}));

vi.mock("@/lib/auth/org-context", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/org-context")>();
  return { ...actual, requireOrgContext: requireOrgContextMock };
});

vi.mock("@/lib/model-studio/flag", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/model-studio/flag")>();
  return {
    ...actual,
    isModelStudioEnabled: isModelStudioEnabledMock,
    setModelStudioEnabled: setModelStudioEnabledMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { GET, PUT } from "./route";

const auth = { user: { id: "user-1" } };
const memberCtx = { orgId: "org-1", role: "member" as const };
const adminCtx = { orgId: "org-1", role: "admin" as const };

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
});

function putRequest(body: unknown) {
  return new Request("https://archoslabs.xyz/api/model-studio/flag", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("GET /api/model-studio/flag", () => {
  it("returns 200 with the flag value for any member", async () => {
    isModelStudioEnabledMock.mockResolvedValue(true);
    const r = await GET(
      new Request("https://archoslabs.xyz/api/model-studio/flag"),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, enabled: true });
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await GET(
      new Request("https://archoslabs.xyz/api/model-studio/flag"),
    );
    expect(r.status).toBe(401);
    expect(isModelStudioEnabledMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/model-studio/flag", () => {
  it("returns 200 and persists the flag for an admin", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: adminCtx });
    setModelStudioEnabledMock.mockResolvedValue(true);
    const r = await PUT(putRequest({ enabled: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, enabled: true });
    expect(setModelStudioEnabledMock).toHaveBeenCalledWith(true);
  });

  it("returns 403 for a non-owner/admin member (penetration)", async () => {
    setModelStudioEnabledMock.mockResolvedValue(true);
    const r = await PUT(putRequest({ enabled: true }));
    expect(r.status).toBe(403);
    expect(setModelStudioEnabledMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-boolean enabled", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: adminCtx });
    const r = await PUT(putRequest({ enabled: "yes" }));
    expect(r.status).toBe(400);
    expect(setModelStudioEnabledMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a missing body", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: adminCtx });
    const r = await PUT(putRequest({}));
    expect(r.status).toBe(400);
    expect(setModelStudioEnabledMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    const r = await PUT(putRequest({ enabled: true }));
    expect(r.status).toBe(401);
    expect(setModelStudioEnabledMock).not.toHaveBeenCalled();
  });
});
