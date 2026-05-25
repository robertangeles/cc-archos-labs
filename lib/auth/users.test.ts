import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  // Routed by table tag — listUsers + getUserDetail use multiple selects,
  // we route each via a per-table mock to keep the chain assertions clean.
  usersSelectMock,
  oauthSelectMock,
  eventsSelectMock,
  sessionsSelectMock,
  countSelectMock,
  usersUpdateMock,
  revokeAllSessionsMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  usersSelectMock: vi.fn(),
  oauthSelectMock: vi.fn(),
  eventsSelectMock: vi.fn(),
  sessionsSelectMock: vi.fn(),
  countSelectMock: vi.fn(),
  usersUpdateMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

// The Drizzle chain looks like: db.select(...).from(table).where(...)
// [.orderBy(...)][.limit(...)][.offset(...)]. We route the terminal call
// (the one that's awaited) by the table the chain started against.
//
// `db.select({...})` — projection — returns a chain whose .from() does
// the routing. Count queries use `db.select({ n: count() })` so we route
// them via a distinct mock by inspecting the projection keys.

// The Drizzle query builder is chain-then-await. We mock it via a
// thenable proxy: every chain method returns the same proxy, and
// awaiting the proxy at any point routes to the table-specific mock.
// This way, both `await db.select().from(users).where(...)` (count
// queries) and `await db.select().from(users).where(...).limit(1)`
// (single-row lookup) resolve to the right canned value.
function makeChain(mock: () => unknown): unknown {
  const chain: Record<string, unknown> = {};
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) =>
    Promise.resolve()
      .then(() => mock())
      .then(resolve, reject);
  return chain;
}

vi.mock("../db", () => ({
  getDb: () => ({
    select: (projection: Record<string, unknown> | undefined) => {
      // Heuristic: count queries select { n: count() }
      const isCount =
        projection != null &&
        Object.keys(projection).length === 1 &&
        Object.keys(projection)[0] === "n";

      const tableMockByName: Record<string, ReturnType<typeof vi.fn>> = {
        users_table: usersSelectMock,
        oauth_account_table: oauthSelectMock,
        auth_event_table: eventsSelectMock,
        user_session_table: sessionsSelectMock,
      };

      return {
        from: (table: { __tag?: string }) => {
          const mock = isCount
            ? countSelectMock
            : (tableMockByName[table.__tag ?? ""] ?? usersSelectMock);
          return makeChain(mock as unknown as () => unknown);
        },
      };
    },
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => usersUpdateMock(...args),
      }),
    }),
  }),
}));

vi.mock("../db/schema", () => ({
  users: { __tag: "users_table" },
  oauthAccount: { __tag: "oauth_account_table" },
  authEvent: { __tag: "auth_event_table" },
  userSession: { __tag: "user_session_table" },
}));

vi.mock("./session", () => ({
  revokeAllSessionsForUser: revokeAllSessionsMock,
}));

vi.mock("./audit", () => ({
  logAuthEvent: logAuthEventMock,
}));

import {
  changeRole,
  getUserDetail,
  listUsers,
  setActive,
} from "./users";

beforeEach(() => {
  vi.clearAllMocks();
  revokeAllSessionsMock.mockResolvedValue(1);
  logAuthEventMock.mockResolvedValue(undefined);
  usersUpdateMock.mockResolvedValue(undefined);
  // Defaults — overridden per test.
  countSelectMock.mockResolvedValue([{ n: 0 }]);
  usersSelectMock.mockResolvedValue([]);
  oauthSelectMock.mockResolvedValue([]);
  eventsSelectMock.mockResolvedValue([]);
  sessionsSelectMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// listUsers
// ============================================================================

describe("listUsers", () => {
  it("returns paginated rows with joined linkedProviders", async () => {
    // Order matters here:
    //   1st select (count) → countSelectMock
    //   2nd select (users) → usersSelectMock
    //   3rd select (oauth providers for ids) → oauthSelectMock
    countSelectMock.mockResolvedValueOnce([{ n: 2 }]);
    usersSelectMock.mockResolvedValueOnce([
      {
        id: "u1",
        email: "a@example.com",
        displayName: "A",
        role: "admin",
        isActive: true,
        emailVerifiedAt: new Date(),
        lastLoginAt: null,
        createdAt: new Date(),
        hasPasswordHash: true,
      },
      {
        id: "u2",
        email: "b@example.com",
        displayName: "B",
        role: "member",
        isActive: true,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: new Date(),
        hasPasswordHash: false,
      },
    ]);
    oauthSelectMock.mockResolvedValueOnce([
      { userId: "u2", provider: "google" },
    ]);

    const r = await listUsers({ page: 1, pageSize: 10 });
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].linkedProviders).toEqual([]);
    expect(r.rows[1].linkedProviders).toEqual(["google"]);
  });

  it("clamps pageSize to 100 and page to ≥1", async () => {
    countSelectMock.mockResolvedValueOnce([{ n: 0 }]);
    usersSelectMock.mockResolvedValueOnce([]);
    const r = await listUsers({ page: 0, pageSize: 9999 });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(100);
  });
});

// ============================================================================
// getUserDetail
// ============================================================================

describe("getUserDetail", () => {
  it("returns null when user not found", async () => {
    usersSelectMock.mockResolvedValueOnce([]);
    const r = await getUserDetail("nope");
    expect(r).toBeNull();
  });

  it("aggregates linkedProviders, recentEvents, activeSessions", async () => {
    usersSelectMock.mockResolvedValueOnce([
      {
        id: "u1",
        email: "a@example.com",
        displayName: "A",
        role: "admin",
        isActive: true,
        emailVerifiedAt: new Date(),
        lastLoginAt: null,
        createdAt: new Date(),
        hasPasswordHash: true,
      },
    ]);
    oauthSelectMock.mockResolvedValueOnce([{ provider: "google" }]);
    eventsSelectMock.mockResolvedValueOnce([
      {
        id: "e1",
        eventType: "login_password",
        ipAddress: "1.1.1.1",
        userAgent: "ua",
        metadata: { foo: "bar" },
        createdAt: new Date(),
      },
    ]);
    sessionsSelectMock.mockResolvedValueOnce([
      {
        id: "s1",
        lastSeenAt: new Date(),
        ipAddress: "1.1.1.1",
        userAgent: "ua",
        createdAt: new Date(),
      },
    ]);

    const r = await getUserDetail("u1");
    expect(r).not.toBeNull();
    expect(r?.linkedProviders).toEqual(["google"]);
    expect(r?.recentEvents).toHaveLength(1);
    expect(r?.recentEvents[0].metadata).toEqual({ foo: "bar" });
    expect(r?.activeSessions).toHaveLength(1);
  });
});

// ============================================================================
// changeRole — guard rails
// ============================================================================

describe("changeRole", () => {
  it("returns ERR_INVALID_ROLE for an unsupported role", async () => {
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "t",
      // @ts-expect-error — testing runtime defense
      newRole: "wizard",
      ipAddress: null,
      userAgent: null,
    });
    expect(r).toEqual({ ok: false, error: "ERR_INVALID_ROLE" });
  });

  it("returns ERR_NOT_FOUND when target user does not exist", async () => {
    usersSelectMock.mockResolvedValueOnce([]);
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "ghost",
      newRole: "member",
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_NOT_FOUND");
    expect(usersUpdateMock).not.toHaveBeenCalled();
    expect(revokeAllSessionsMock).not.toHaveBeenCalled();
  });

  it("returns ERR_NO_CHANGE when target already has that role", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "admin", isActive: true },
    ]);
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "t1",
      newRole: "admin",
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_NO_CHANGE");
    expect(usersUpdateMock).not.toHaveBeenCalled();
  });

  it("REFUSES to demote the last active admin (ERR_LAST_ADMIN)", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "admin", isActive: true },
    ]);
    countSelectMock.mockResolvedValueOnce([{ n: 1 }]); // only one admin
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "t1",
      newRole: "member",
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_LAST_ADMIN");
    expect(usersUpdateMock).not.toHaveBeenCalled();
    expect(revokeAllSessionsMock).not.toHaveBeenCalled();
  });

  it("ALLOWS demoting an admin when other admins exist", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "admin", isActive: true },
    ]);
    countSelectMock.mockResolvedValueOnce([{ n: 2 }]); // multiple admins
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "t1",
      newRole: "member",
      ipAddress: "1.2.3.4",
      userAgent: "ua",
    });
    expect(r.ok).toBe(true);
    expect(usersUpdateMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("t1");
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "t1",
        eventType: "role_changed",
        metadata: expect.objectContaining({
          from_role: "admin",
          to_role: "member",
          changed_by_user_id: "actor",
        }),
      }),
    );
  });

  it("happy path: promote a member to admin (no last-admin check needed)", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "member", isActive: true },
    ]);
    const r = await changeRole({
      actorUserId: "actor",
      targetUserId: "t1",
      newRole: "admin",
      ipAddress: null,
      userAgent: null,
    });
    expect(r.ok).toBe(true);
    // No count call needed when promoting → countSelectMock not invoked.
    expect(countSelectMock).not.toHaveBeenCalled();
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("t1");
  });
});

// ============================================================================
// setActive — guard rails
// ============================================================================

describe("setActive", () => {
  it("REFUSES self-deactivation (ERR_SELF_DEACTIVATE)", async () => {
    const r = await setActive({
      actorUserId: "u1",
      targetUserId: "u1",
      active: false,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_SELF_DEACTIVATE");
    expect(usersSelectMock).not.toHaveBeenCalled(); // short-circuits before DB
  });

  it("ALLOWS self-reactivation (admin can reactivate their own row, edge case)", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "u1", role: "admin", isActive: false },
    ]);
    const r = await setActive({
      actorUserId: "u1",
      targetUserId: "u1",
      active: true,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.ok).toBe(true);
  });

  it("returns ERR_NOT_FOUND when target missing", async () => {
    usersSelectMock.mockResolvedValueOnce([]);
    const r = await setActive({
      actorUserId: "actor",
      targetUserId: "ghost",
      active: false,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_NOT_FOUND");
  });

  it("returns ERR_NO_CHANGE when target already in that state", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "member", isActive: true },
    ]);
    const r = await setActive({
      actorUserId: "actor",
      targetUserId: "t1",
      active: true,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_NO_CHANGE");
  });

  it("REFUSES deactivating the last active admin (ERR_LAST_ADMIN)", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "admin", isActive: true },
    ]);
    countSelectMock.mockResolvedValueOnce([{ n: 1 }]);
    const r = await setActive({
      actorUserId: "actor",
      targetUserId: "t1",
      active: false,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.error).toBe("ERR_LAST_ADMIN");
    expect(usersUpdateMock).not.toHaveBeenCalled();
  });

  it("happy path deactivate: updates row + revokes sessions + audit", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "member", isActive: true },
    ]);
    const r = await setActive({
      actorUserId: "actor",
      targetUserId: "t1",
      active: false,
      ipAddress: "1.2.3.4",
      userAgent: "ua",
    });
    expect(r.ok).toBe(true);
    expect(usersUpdateMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsMock).toHaveBeenCalledWith("t1");
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "t1",
        eventType: "user_deactivated",
      }),
    );
  });

  it("happy path reactivate: updates row but does NOT revoke sessions", async () => {
    usersSelectMock.mockResolvedValueOnce([
      { id: "t1", role: "member", isActive: false },
    ]);
    const r = await setActive({
      actorUserId: "actor",
      targetUserId: "t1",
      active: true,
      ipAddress: null,
      userAgent: null,
    });
    expect(r.ok).toBe(true);
    expect(usersUpdateMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "t1",
        eventType: "user_reactivated",
      }),
    );
  });
});
