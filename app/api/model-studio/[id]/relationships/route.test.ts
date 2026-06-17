import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Route-handler tests for the Model Studio relationship endpoints. Service
// logic is proven in tests/model-studio/relationship-service.test.ts; these
// cover the route layer (incl. the InvalidEndpointError -> 400 and
// VERSION_CONFLICT -> 409 mappings). Auth boundary + service mocked.
// ============================================================================

const {
  requireOrgContextMock,
  listRelationshipsMock,
  createRelationshipMock,
  updateRelationshipMock,
  deleteRelationshipMock,
} = vi.hoisted(() => ({
  requireOrgContextMock: vi.fn(),
  listRelationshipsMock: vi.fn(),
  createRelationshipMock: vi.fn(),
  updateRelationshipMock: vi.fn(),
  deleteRelationshipMock: vi.fn(),
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
    listRelationships: listRelationshipsMock,
    createRelationship: createRelationshipMock,
    updateRelationship: updateRelationshipMock,
    deleteRelationship: deleteRelationshipMock,
  };
});

import { OrgAuthError } from "@/lib/auth/org-context";
import {
  InvalidEndpointError,
  VersionConflictError,
} from "@/lib/model-studio/canvas-service";
import { GET as listGET, POST } from "./route";
import { PATCH, DELETE } from "./[relationshipId]/route";

const auth = { user: { id: "user-1" } };
const ownerCtx = { orgId: "org-1", role: "owner" as const };
const memberCtx = { orgId: "org-1", role: "member" as const };
const MODEL = "22222222-2222-4222-8222-222222222222";
const REL = "66666666-6666-4666-8666-666666666666";
const ENT = "33333333-3333-4333-8333-333333333333";
const base = `https://archoslabs.xyz/api/model-studio/${MODEL}/relationships`;

const collParams = () => ({ params: Promise.resolve({ id: MODEL }) });
const oneParams = () => ({ params: Promise.resolve({ id: MODEL, relationshipId: REL }) });

const validBody = {
  sourceEntityId: ENT,
  targetEntityId: "77777777-7777-4777-8777-777777777777",
  sourceCardinality: "one",
  targetCardinality: "many",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgContextMock.mockResolvedValue({ auth, ctx: ownerCtx });
});

describe("GET/POST /relationships", () => {
  it("GET returns 200 for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    listRelationshipsMock.mockResolvedValue([{ id: REL }]);
    const r = await listGET(new Request(base), collParams());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, relationships: [{ id: REL }] });
  });

  it("GET returns 404 when the model is not in the org", async () => {
    listRelationshipsMock.mockResolvedValue(null);
    expect((await listGET(new Request(base), collParams())).status).toBe(404);
  });

  it("GET returns 401 unauthenticated (penetration)", async () => {
    requireOrgContextMock.mockRejectedValue(
      new OrgAuthError(401, "unauthenticated", "Authentication required"),
    );
    expect((await listGET(new Request(base), collParams())).status).toBe(401);
  });

  const post = (b: unknown) =>
    new Request(base, { method: "POST", body: JSON.stringify(b) });

  it("POST returns 201 for an owner", async () => {
    createRelationshipMock.mockResolvedValue({ id: REL, version: 1 });
    expect((await POST(post(validBody), collParams())).status).toBe(201);
  });

  it("POST returns 403 for a member", async () => {
    requireOrgContextMock.mockResolvedValue({ auth, ctx: memberCtx });
    expect((await POST(post(validBody), collParams())).status).toBe(403);
  });

  it("POST returns 400 on a bad cardinality", async () => {
    const r = await POST(post({ ...validBody, sourceCardinality: "1..1" }), collParams());
    expect(r.status).toBe(400);
    expect(createRelationshipMock).not.toHaveBeenCalled();
  });

  it("POST returns 400 when an endpoint is cross-model", async () => {
    createRelationshipMock.mockRejectedValue(new InvalidEndpointError("foreign"));
    expect((await POST(post(validBody), collParams())).status).toBe(400);
  });

  it("POST returns 404 when the model is not in the org", async () => {
    createRelationshipMock.mockResolvedValue(null);
    expect((await POST(post(validBody), collParams())).status).toBe(404);
  });
});

describe("PATCH/DELETE /relationships/:relationshipId", () => {
  const patch = (b: unknown) =>
    new Request(`${base}/${REL}`, { method: "PATCH", body: JSON.stringify(b) });

  it("PATCH returns 200 and bumps version", async () => {
    updateRelationshipMock.mockResolvedValue({ id: REL, version: 2 });
    const r = await PATCH(patch({ isIdentifying: true, version: 1 }), oneParams());
    expect(r.status).toBe(200);
  });

  it("PATCH returns 409 VERSION_CONFLICT on a stale write", async () => {
    updateRelationshipMock.mockRejectedValue(new VersionConflictError(3));
    const r = await PATCH(patch({ isIdentifying: true, version: 1 }), oneParams());
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "VERSION_CONFLICT", serverVersion: 3 });
  });

  it("PATCH returns 400 when version is missing", async () => {
    expect((await PATCH(patch({ isIdentifying: true }), oneParams())).status).toBe(400);
  });

  it("DELETE returns 200 then 404", async () => {
    deleteRelationshipMock.mockResolvedValue(true);
    expect(
      (await DELETE(new Request(`${base}/${REL}`, { method: "DELETE" }), oneParams())).status,
    ).toBe(200);
    deleteRelationshipMock.mockResolvedValue(false);
    expect(
      (await DELETE(new Request(`${base}/${REL}`, { method: "DELETE" }), oneParams())).status,
    ).toBe(404);
  });
});
