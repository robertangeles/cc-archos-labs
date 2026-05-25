import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setActiveMock, dbSelectMock } = vi.hoisted(() => ({
  setActiveMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock("../../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: dbSelectMock }) }),
    }),
  }),
}));
vi.mock("../../../../../../lib/db/schema", () => ({ users: {} }));
vi.mock("../../../../../../lib/auth/users", () => ({
  setActive: setActiveMock,
}));
vi.mock("../../../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
}));

import { PATCH } from "./route";

function makeRequest(id: string, body: unknown): {
  request: Request;
  params: Promise<{ id: string }>;
} {
  return {
    request: new Request(
      `https://archoslabs.xyz/api/admin/users/${id}/active`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
    ),
    params: Promise.resolve({ id }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectMock.mockResolvedValue([{ id: "actor-admin-id" }]);
  setActiveMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/admin/users/[id]/active", () => {
  it("returns 400 on invalid body", async () => {
    const { request, params } = makeRequest("u1", { active: "yes" });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(400);
  });

  it("returns 409 on ERR_SELF_DEACTIVATE", async () => {
    setActiveMock.mockResolvedValueOnce({
      ok: false,
      error: "ERR_SELF_DEACTIVATE",
    });
    const { request, params } = makeRequest("u1", { active: false });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(409);
    const json = await r.json();
    expect(json.error).toContain("themselves");
  });

  it("returns 409 on ERR_LAST_ADMIN", async () => {
    setActiveMock.mockResolvedValueOnce({
      ok: false,
      error: "ERR_LAST_ADMIN",
    });
    const { request, params } = makeRequest("u1", { active: false });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("last active admin");
  });

  it("returns 200 on success deactivate", async () => {
    const { request, params } = makeRequest("u1", { active: false });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(200);
    expect(setActiveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "actor-admin-id",
        targetUserId: "u1",
        active: false,
      }),
    );
  });
});
