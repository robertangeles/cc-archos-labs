import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listUsersMock } = vi.hoisted(() => ({
  listUsersMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/users", () => ({
  listUsers: listUsersMock,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  listUsersMock.mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/users", () => {
  it("returns 200 with empty list by default", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/admin/users"),
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json).toMatchObject({ ok: true, rows: [], total: 0 });
  });

  it("threads through query params to listUsers", async () => {
    listUsersMock.mockResolvedValueOnce({
      rows: [{ id: "u1" }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
    const r = await GET(
      new Request(
        "https://archoslabs.xyz/api/admin/users?page=2&pageSize=10&role=admin&active=active&search=rob",
      ),
    );
    expect(r.status).toBe(200);
    expect(listUsersMock).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      roleFilter: "admin",
      activeFilter: "active",
      search: "rob",
    });
  });

  it("returns 400 on invalid query (pageSize > 100)", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/admin/users?pageSize=9999"),
    );
    expect(r.status).toBe(400);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid role enum", async () => {
    const r = await GET(
      new Request("https://archoslabs.xyz/api/admin/users?role=wizard"),
    );
    expect(r.status).toBe(400);
  });
});
