import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JUDGE_PROMPT_KEY,
  JUDGE_PROMPT_STARTER,
  PLAN_PROMPT_KEY,
} from "../../../../../../lib/blog-agent/config-shared";

// One route serving two prompts. The thing worth testing is the kind lookup:
// an unknown kind must 404 rather than falling through to a default key and
// writing the judge rubric over something else.

const rows: Array<{ value: unknown; updatedAt: Date }> = [];
const insertValues = vi.fn();

vi.mock("../../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => rows }) }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  }),
}));

const { GET, PUT } = await import("./route");

const ctx = (kind: string) => ({ params: Promise.resolve({ kind }) });

function req(body: unknown) {
  return new Request("https://archoslabs.xyz/x", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { systemPrompt: "x".repeat(60), version: "v2" };

afterEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
});

describe("kind routing", () => {
  it("writes the judge prompt to the judge key", async () => {
    await PUT(req(VALID), ctx("judge"));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ key: JUDGE_PROMPT_KEY }),
    );
  });

  it("writes the plan prompt to the plan key", async () => {
    await PUT(req(VALID), ctx("plan"));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ key: PLAN_PROMPT_KEY }),
    );
  });

  it("404s an unknown kind instead of defaulting to one of them", async () => {
    expect((await GET(new Request("https://x/y"), ctx("nope"))).status).toBe(404);
    const res = await PUT(req(VALID), ctx("nope"));
    expect(res.status).toBe(404);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("is not fooled by a prototype key", async () => {
    // `"constructor" in KINDS` is true on a plain object literal.
    const res = await PUT(req(VALID), ctx("constructor"));
    expect(res.status).toBe(404);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("returns the starter when nothing is stored", async () => {
    const json = await (await GET(new Request("https://x/y"), ctx("judge"))).json();
    expect(json.isFallback).toBe(true);
    expect(json.data.systemPrompt).toBe(JUDGE_PROMPT_STARTER.systemPrompt);
  });

  it("rejects a prompt shorter than the schema allows", async () => {
    const res = await PUT(req({ systemPrompt: "too short", version: "v1" }), ctx("judge"));
    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects an empty version label", async () => {
    const res = await PUT(req({ ...VALID, version: "" }), ctx("judge"));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    expect((await PUT(req("{nope"), ctx("judge"))).status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
