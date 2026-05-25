import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { changeRoleMock, dbSelectMock } = vi.hoisted(() => ({
  changeRoleMock: vi.fn(),
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
  changeRole: changeRoleMock,
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
      `https://archoslabs.xyz/api/admin/users/${id}/role`,
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
  changeRoleMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/admin/users/[id]/role", () => {
  it("returns 400 on missing id", async () => {
    const { request } = makeRequest("", { role: "admin" });
    const r = await PATCH(request, {
      params: Promise.resolve({ id: "" }),
    });
    expect(r.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const { request, params } = makeRequest("u1", "{not-json");
    const r = await PATCH(request, { params });
    expect(r.status).toBe(400);
  });

  it("returns 400 on invalid role value", async () => {
    const { request, params } = makeRequest("u1", { role: "wizard" });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(400);
  });

  it("returns 409 on ERR_LAST_ADMIN", async () => {
    changeRoleMock.mockResolvedValueOnce({ ok: false, error: "ERR_LAST_ADMIN" });
    const { request, params } = makeRequest("u1", { role: "member" });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(409);
    const json = await r.json();
    expect(json.error).toContain("last active admin");
  });

  it("returns 404 on ERR_NOT_FOUND", async () => {
    changeRoleMock.mockResolvedValueOnce({ ok: false, error: "ERR_NOT_FOUND" });
    const { request, params } = makeRequest("ghost", { role: "admin" });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(404);
  });

  it("returns 200 on success", async () => {
    const { request, params } = makeRequest("u1", { role: "admin" });
    const r = await PATCH(request, { params });
    expect(r.status).toBe(200);
    expect(changeRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "actor-admin-id",
        targetUserId: "u1",
        newRole: "admin",
      }),
    );
  });
});
