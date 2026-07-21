import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Covers /api/brain/memories (in-app pgvector backend): the DB path keeps the
// exact client contract ({ memories: [{ slug, title, content, updatedAt }] } and
// DELETE ?slug=) so the Brain page needs no change.
//
// The E4 inspector adds a SECOND tier to the same route — the org-shared
// workspace memories — so these tests also pin the isolation rule: the org id
// always comes from the server-resolved context, never from the request.

const {
  getCurrentUserMock,
  rateLimitMock,
  listMock,
  deleteMock,
  listWorkspaceMock,
  deactivateWorkspaceMock,
  resolveOrgContextMock,
  getOrgIdFromCookiesMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  listMock: vi.fn(),
  deleteMock: vi.fn(),
  listWorkspaceMock: vi.fn(),
  deactivateWorkspaceMock: vi.fn(),
  resolveOrgContextMock: vi.fn(),
  getOrgIdFromCookiesMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("../../../../lib/brain/memory", () => ({
  listMemoriesFromDb: listMock,
  deleteMemoryFromDb: deleteMock,
  listWorkspaceMemoriesFromDb: listWorkspaceMock,
  deactivateWorkspaceMemory: deactivateWorkspaceMock,
}));
vi.mock("../../../../lib/auth/org-context", () => ({
  resolveOrgContext: resolveOrgContextMock,
  getOrgIdFromCookies: getOrgIdFromCookiesMock,
}));

import { GET, DELETE } from "./route";

const SESSION = { user: { id: "user-1" } };
const MEM_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

const delReq = (slug: string, scope?: string) =>
  new Request(
    `http://t/api/brain/memories?${scope ? `scope=${scope}&` : ""}slug=${encodeURIComponent(slug)}`,
    { method: "DELETE" },
  );

const WS_ROW = {
  id: WS_ID,
  sourceType: "project",
  sourceEntityId: "44444444-4444-4444-8444-444444444444",
  entityName: "Acme Data Platform",
  content: 'Project "Acme Data Platform" (active) for client Acme Corp',
  updatedAt: "2026-07-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  rateLimitMock.mockReturnValue({ ok: true, remaining: 49, resetAt: 0 });
  listMock.mockResolvedValue([
    { id: MEM_ID, title: "My project", content: "About Westpac", updatedAt: "2026-07-01T00:00:00.000Z" },
  ]);
  deleteMock.mockResolvedValue(true);
  listWorkspaceMock.mockResolvedValue([WS_ROW]);
  deactivateWorkspaceMock.mockResolvedValue(true);
  resolveOrgContextMock.mockResolvedValue({ orgId: ORG_ID, role: "owner" });
  getOrgIdFromCookiesMock.mockResolvedValue(ORG_ID);
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/brain/memories (pgvector)", () => {
  it("401 when unauthenticated, no DB work", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await GET();
    expect(r.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
    expect(listWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns memories with slug = row id (client contract preserved)", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.memories).toEqual([
      { slug: MEM_ID, title: "My project", content: "About Westpac", updatedAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(listMock).toHaveBeenCalledWith("user-1");
  });

  it("returns the workspace tier scoped to the SERVER-resolved org", async () => {
    const r = await GET();
    const body = await r.json();
    expect(body.workspace).toEqual([
      {
        slug: WS_ID,
        sourceType: "project",
        sourceEntityId: WS_ROW.sourceEntityId,
        entityName: "Acme Data Platform",
        content: WS_ROW.content,
        updatedAt: WS_ROW.updatedAt,
      },
    ]);
    // Isolation: the org comes from resolveOrgContext, which re-validates
    // membership — never straight from the cookie.
    expect(listWorkspaceMock).toHaveBeenCalledWith(ORG_ID);
    expect(resolveOrgContextMock).toHaveBeenCalledWith("user-1", ORG_ID);
  });

  it("owner/admin may prune shared memories; a member may not", async () => {
    await expect((await GET()).json()).resolves.toMatchObject({
      canDeleteWorkspace: true,
    });

    resolveOrgContextMock.mockResolvedValueOnce({ orgId: ORG_ID, role: "member" });
    await expect((await GET()).json()).resolves.toMatchObject({
      canDeleteWorkspace: false,
    });
  });

  it("degrades to the private tier when the user has no org", async () => {
    resolveOrgContextMock.mockResolvedValueOnce(null);
    const body = await (await GET()).json();
    expect(body.workspace).toEqual([]);
    expect(body.memories).toHaveLength(1);
    expect(listWorkspaceMock).not.toHaveBeenCalled();
  });

  it("is fail-soft — a workspace query failure still renders chat memories", async () => {
    listWorkspaceMock.mockRejectedValueOnce(new Error("pg down"));
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.workspace).toEqual([]);
    expect(body.memories).toHaveLength(1);
  });
});

describe("DELETE /api/brain/memories (pgvector)", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await DELETE(delReq(MEM_ID));
    expect(r.status).toBe(401);
  });

  it("429 when rate limited", async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, remaining: 0, resetAt: 0 });
    const r = await DELETE(delReq(MEM_ID));
    expect(r.status).toBe(429);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("400 on a path-traversal slug, no delete attempted", async () => {
    const r = await DELETE(delReq("../../etc/passwd"));
    expect(r.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes scoped to the caller and returns 200", async () => {
    const r = await DELETE(delReq(MEM_ID));
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ deleted: true });
    // Authz: the user id comes from the session, never the request.
    expect(deleteMock).toHaveBeenCalledWith("user-1", MEM_ID);
  });

  it("404 when the row is not the caller's (delete returns false)", async () => {
    deleteMock.mockResolvedValueOnce(false);
    const r = await DELETE(delReq(MEM_ID));
    expect(r.status).toBe(404);
  });
});

describe("DELETE ?scope=workspace (org-shared tier)", () => {
  it("soft-deletes using the resolved org id, not anything from the request", async () => {
    const r = await DELETE(delReq(WS_ID, "workspace"));
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ deleted: true });
    expect(deactivateWorkspaceMock).toHaveBeenCalledWith(ORG_ID, WS_ID);
    // The private-tier delete must not fire for a workspace-scoped request.
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("403 for a plain member — pruning shared knowledge is owner/admin only", async () => {
    resolveOrgContextMock.mockResolvedValueOnce({ orgId: ORG_ID, role: "member" });
    const r = await DELETE(delReq(WS_ID, "workspace"));
    expect(r.status).toBe(403);
    expect(deactivateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("404 when the caller has no org context", async () => {
    resolveOrgContextMock.mockResolvedValueOnce(null);
    const r = await DELETE(delReq(WS_ID, "workspace"));
    expect(r.status).toBe(404);
    expect(deactivateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("404 when the row belongs to another org (no existence oracle)", async () => {
    // deactivateWorkspaceMemory filters on organisation_id, so a valid id from
    // another tenant simply updates 0 rows.
    deactivateWorkspaceMock.mockResolvedValueOnce(false);
    const r = await DELETE(delReq(WS_ID, "workspace"));
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toEqual({ error: "Not found" });
  });

  it("still rate-limits and validates the slug on the workspace path", async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, remaining: 0, resetAt: 0 });
    expect((await DELETE(delReq(WS_ID, "workspace"))).status).toBe(429);

    const bad = await DELETE(delReq("../../etc/passwd", "workspace"));
    expect(bad.status).toBe(400);
    expect(deactivateWorkspaceMock).not.toHaveBeenCalled();
  });
});
