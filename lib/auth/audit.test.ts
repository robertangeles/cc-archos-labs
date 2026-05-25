import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const valuesMock = vi.fn();

// Mock the DB layer. The chain looks like: db.insert(table).values(data).
// insert() returns an object whose .values() resolves; we route both
// through spies so we can assert on them.
vi.mock("../db", () => ({
  getDb: () => ({
    insert: (table: unknown) => {
      insertMock(table);
      return { values: valuesMock };
    },
  }),
}));

vi.mock("../db/schema", () => ({
  authEvent: { __tag: "authEvent_table_marker" },
}));

import { logAuthEvent } from "./audit";

beforeEach(() => {
  insertMock.mockClear();
  valuesMock.mockClear();
  valuesMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAuthEvent — happy path", () => {
  it("writes an auth_event row with the given fields", async () => {
    await logAuthEvent({
      userId: "user-1",
      eventType: "login_password",
      ipAddress: "192.0.2.5",
      userAgent: "ua-string",
      metadata: { foo: "bar" },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      __tag: "authEvent_table_marker",
    });

    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith({
      userId: "user-1",
      eventType: "login_password",
      ipAddress: "192.0.2.5",
      userAgent: "ua-string",
      metadata: { foo: "bar" },
    });
  });

  it("defaults metadata to {} when omitted", async () => {
    await logAuthEvent({
      userId: "user-2",
      eventType: "logout",
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("accepts a null userId (failed-login rows)", async () => {
    await logAuthEvent({
      userId: null,
      eventType: "login_failed",
      metadata: { reason: "unknown_email" },
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        eventType: "login_failed",
        metadata: { reason: "unknown_email" },
      }),
    );
  });

  it("nullifies missing ip / ua fields", async () => {
    await logAuthEvent({ userId: "user-3", eventType: "logout" });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: null, userAgent: null }),
    );
  });
});

describe("logAuthEvent — never-throw contract", () => {
  it("swallows DB errors so the auth flow keeps running", async () => {
    valuesMock.mockRejectedValueOnce(new Error("DB connection lost"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAuthEvent({ userId: "user-1", eventType: "logout" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    // First arg is the log line; second is the error message.
    const call = errSpy.mock.calls[0];
    expect(String(call[0])).toContain("[auth/audit]");
    expect(String(call[0])).toContain("logout");
  });

  it("swallows synchronous errors from getDb itself", async () => {
    // Use a deferred-style override: temporarily make insert() throw.
    insertMock.mockImplementationOnce(() => {
      throw new Error("getDb crashed mid-chain");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAuthEvent({ userId: "user-1", eventType: "login_password" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
  });
});
