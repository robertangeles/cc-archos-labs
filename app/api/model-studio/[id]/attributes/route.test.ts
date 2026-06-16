import { beforeEach, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler test for the batch model-attribute load. Service logic is
// proven in tests/model-studio/attribute-service.test.ts; this covers the
// route layer (200 / 404 / 401). Auth boundary + service mocked.
// ============================================================================

const { requireOrgContextMock, listModelAttributesMock } = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  listModelAttributesMock: vi.fn(),
}));

vi.mock("@/lib/auth/org-context", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/org-context")>();
  return { ...actual, requireOrgContext: requireOrgContextMock };
});

vi.mock("@/lib/model-studio/canvas-service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/model-studio/canvas-service")>();
  return { ...actual, listModelAttributes: listModelAttributesMock };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import { GET } from "./route";

const auth = { user: { id: "user-1" } };
const memberCtx = { orgId: "org-1", role: "member" as const };
const MODEL = "22222222-2222-4222-8222-222222222222";
const base = `https://archoslabs.xyz/api/model-studio/${MODEL}/attributes`;
const params = () => ({ params: Promise.resolve({ id: MODEL }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
});

it("returns 200 with every attribute for a member", async () => {
  listModelAttributesMock.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  const r = await GET(new Request(base), params());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ ok: true, attributes: [{ id: "a1" }, { id: "a2" }] });
});

it("returns 404 when the model is not in the org", async () => {
  listModelAttributesMock.mockResolvedValue(null);
  expect((await GET(new Request(base), params())).status).toBe(404);
});

it("returns 401 unauthenticated (penetration)", async () => {
  requireOrgContextMock.mockRejectedValue(
    new OrgAuthError(401, "unauthenticated", "Authentication required"),
  );
  expect((await GET(new Request(base), params())).status).toBe(401);
});
