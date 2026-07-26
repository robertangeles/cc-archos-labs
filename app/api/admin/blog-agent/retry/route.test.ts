import { afterEach, describe, expect, it, vi } from "vitest";

// The retry endpoint. Two properties matter more than the happy path:
// it must never resurrect a `running` item (that item would be claimed and
// billed twice), and it must clear the attempts counter (the sweeper parks at
// three, so a retry that left the counter alone would fail once and park
// again, looking like the button was broken).

const setSpy = vi.fn();
const whereSpy = vi.fn();
let returning: Array<{ id: string }> = [];

vi.mock("../../../../../lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (v: unknown) => {
        setSpy(v);
        return {
          where: (w: unknown) => {
            whereSpy(w);
            return { returning: async () => returning };
          },
        };
      },
    }),
  }),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("https://archoslabs.xyz/api/admin/blog-agent/retry", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  returning = [];
  vi.clearAllMocks();
});

describe("POST", () => {
  it("returns a failed item to pending", async () => {
    returning = [{ id: "item-1" }];
    const res = await POST(req({ id: "item-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "item-1" });
  });

  it("clears the attempts counter, not just the status", async () => {
    // The sweeper parks an item at three attempts. Leaving the counter alone
    // means it fails once and is parked again immediately.
    returning = [{ id: "item-1" }];
    await POST(req({ id: "item-1" }));
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", attempts: 0, lastError: null }),
    );
  });

  it("clears the lock as well, so a crashed run does not block it", async () => {
    returning = [{ id: "item-1" }];
    await POST(req({ id: "item-1" }));
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ lockedBy: null, lockedUntil: null }),
    );
  });

  it("409s when the row was not in a failed state", async () => {
    // The UPDATE is guarded on status='failed', so a running or already-retried
    // row matches nothing. That guard is what stops an item being claimed and
    // billed twice.
    returning = [];
    const res = await POST(req({ id: "item-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not in a failed state/i);
  });
});

describe("POST rejects bad input", () => {
  it("400s on malformed JSON", async () => {
    const res = await POST(req("{nope"));
    expect(res.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("400s on a missing, empty, or non-string id", async () => {
    for (const body of [{}, { id: "" }, { id: 42 }, { id: null }, { id: ["a"] }]) {
      vi.clearAllMocks();
      const res = await POST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(setSpy).not.toHaveBeenCalled();
    }
  });

  it("does not treat an object id as a way to smuggle a query", async () => {
    // The id goes into eq() as a bound parameter, but rejecting non-strings
    // outright means it never reaches the query builder at all.
    const res = await POST(req({ id: { toString: "nope" } }));
    expect(res.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
