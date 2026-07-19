import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Covers the pgvector backend path of /api/brain/memories. The GBrain path is
// unchanged and exercised by the live service; here we prove the DB path keeps
// the exact client contract ({ memories: [{ slug, title, content, updatedAt }] }
// and DELETE ?slug=) so the Brain page needs no change.

const {
  getCurrentUserMock,
  rateLimitMock,
  memoryBackendMock,
  listMock,
  deleteMock,
  getBrainTokenMock,
  callMcpMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  memoryBackendMock: vi.fn(),
  listMock: vi.fn(),
  deleteMock: vi.fn(),
  getBrainTokenMock: vi.fn(),
  callMcpMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("../../../../lib/brain/memory", () => ({
  memoryBackend: memoryBackendMock,
  listMemoriesFromDb: listMock,
  deleteMemoryFromDb: deleteMock,
}));
vi.mock("../../../../lib/brain/provision", () => ({
  getBrainToken: getBrainTokenMock,
}));
vi.mock("../../../../lib/brain/client", () => ({ callMcp: callMcpMock }));

import { GET, DELETE } from "./route";

const SESSION = { user: { id: "user-1" } };
const MEM_ID = "11111111-1111-4111-8111-111111111111";
const delReq = (slug: string) =>
  new Request(`http://t/api/brain/memories?slug=${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  rateLimitMock.mockReturnValue({ ok: true, remaining: 49, resetAt: 0 });
  memoryBackendMock.mockReturnValue("pgvector");
  listMock.mockResolvedValue([
    { id: MEM_ID, title: "My project", content: "About Westpac", updatedAt: "2026-07-01T00:00:00.000Z" },
  ]);
  deleteMock.mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/brain/memories (pgvector)", () => {
  it("401 when unauthenticated, no DB work", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await GET();
    expect(r.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns memories with slug = row id (client contract preserved)", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      memories: [
        { slug: MEM_ID, title: "My project", content: "About Westpac", updatedAt: "2026-07-01T00:00:00.000Z" },
      ],
    });
    expect(listMock).toHaveBeenCalledWith("user-1");
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
