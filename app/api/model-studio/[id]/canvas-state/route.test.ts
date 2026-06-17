import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio canvas-state endpoint. Per-user view
// state — any member may read/write their own row (no role gate). Service logic
// is proven in tests/model-studio/canvas-state-service.test.ts; these cover the
// route layer. Auth boundary + service mocked.
// ============================================================================

const { requireOrgContextMock, getCanvasStateMock, saveCanvasStateMock } =
  vi.hoisted(() => ({
    requireOrgContextMock: vi.fn(),
    getCanvasStateMock: vi.fn(),
    saveCanvasStateMock: vi.fn(),
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
    getCanvasState: getCanvasStateMock,
    saveCanvasState: saveCanvasStateMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { GET, PUT } from "./route";

const auth = { user: { id: "user-1" } };
const memberCtx = { orgId: "org-1", role: "member" as const };
const MODEL = "22222222-2222-4222-8222-222222222222";
const base = `https://archoslabs.xyz/api/model-studio/${MODEL}/canvas-state`;
const params = () => ({ params: Promise.resolve({ id: MODEL }) });

const validBody = {
  layer: "logical",
  nodePositions: {},
  viewport: { x: 0, y: 0, zoom: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  // A plain member — proves no owner/admin gate on per-user state.
  requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
});

describe("GET /canvas-state", () => {
  it("returns 200 with the caller's state, keyed by their session user id", async () => {
    getCanvasStateMock.mockResolvedValue({ layer: "logical", nodePositions: {} });
    const r = await GET(new Request(`${base}?layer=logical`), params());
    expect(r.status).toBe(200);
    expect(getCanvasStateMock).toHaveBeenCalledWith("org-1", MODEL, "user-1", "logical");
  });

  it("returns 400 when layer is missing/invalid", async () => {
    expect((await GET(new Request(base), params())).status).toBe(400);
    expect((await GET(new Request(`${base}?layer=bad`), params())).status).toBe(400);
  });

  it("returns 404 when the model is not in the org", async () => {
    getCanvasStateMock.mockResolvedValue(null);
    expect((await GET(new Request(`${base}?layer=logical`), params())).status).toBe(404);
  });

  it("returns 401 unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    expect((await GET(new Request(`${base}?layer=logical`), params())).status).toBe(401);
  });
});

describe("PUT /canvas-state", () => {
  const put = (b: unknown) =>
    new Request(base, { method: "PUT", body: JSON.stringify(b) });

  it("lets a plain member upsert their own state (no role gate)", async () => {
    saveCanvasStateMock.mockResolvedValue({ layer: "logical", nodePositions: {} });
    const r = await PUT(put(validBody), params());
    expect(r.status).toBe(200);
    expect(saveCanvasStateMock).toHaveBeenCalledWith(
      "org-1",
      MODEL,
      "user-1",
      expect.objectContaining({ layer: "logical" }),
    );
  });

  it("returns 400 on a malformed body", async () => {
    const r = await PUT(put({ layer: "logical", nodePositions: { x: { x: 1 } } }), params());
    expect(r.status).toBe(400);
  });

  it("returns 404 when the model is not in the org", async () => {
    saveCanvasStateMock.mockResolvedValue(null);
    expect((await PUT(put(validBody), params())).status).toBe(404);
  });
});
