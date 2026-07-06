import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema";

// Real-DB test of the E1 "make permanent" surgical prompt append: owner-scoped,
// touches only the one step. Minimal isolated tables (see runs.amend.test.ts for
// why the full migration can't be dropped into the org harness).
let client: PGlite;
let db: ReturnType<typeof drizzle>;

vi.mock("../db", () => ({ getDb: () => db }));

import { appendStepPrompt } from "./service";

const WID = "11111111-1111-1111-1111-111111111111";
const UID = "44444444-4444-4444-4444-444444444444";
const OTHER_UID = "55555555-5555-5555-5555-555555555555";

async function stepPrompt(stepId: string): Promise<string> {
  const r = await client.query<{ prompt: string }>(
    `SELECT prompt FROM workflow_step WHERE step_id = $1 AND workflow_id = $2`,
    [stepId, WID],
  );
  return r.rows[0]?.prompt ?? "";
}

beforeEach(async () => {
  client = new PGlite();
  await client.query(`CREATE TABLE "workflow" ("id" uuid PRIMARY KEY, "user_id" uuid)`);
  await client.query(`
    CREATE TABLE "workflow_step" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workflow_id" uuid NOT NULL,
      "step_id" varchar(100) NOT NULL,
      "prompt" text NOT NULL DEFAULT ''
    )
  `);
  await client.query(`INSERT INTO "workflow" ("id","user_id") VALUES ($1,$2)`, [WID, UID]);
  await client.query(
    `INSERT INTO "workflow_step" ("workflow_id","step_id","prompt") VALUES ($1,$2,$3)`,
    [WID, "s1", "Write a haiku."],
  );
  db = drizzle(client, { schema }) as never;
});

afterEach(async () => {
  await client.close();
});

describe("appendStepPrompt", () => {
  it("appends the feedback to the owning user's step prompt", async () => {
    const res = await appendStepPrompt(WID, "s1", UID, "be more concise");
    expect(res).toBe("ok");
    const prompt = await stepPrompt("s1");
    expect(prompt).toContain("Write a haiku.");
    expect(prompt).toContain("Refinement (from feedback): be more concise");
  });

  it("refuses a non-owner and leaves the prompt untouched", async () => {
    const res = await appendStepPrompt(WID, "s1", OTHER_UID, "hack the prompt");
    expect(res).toBe("not_found");
    expect(await stepPrompt("s1")).toBe("Write a haiku.");
  });

  it("returns not_found when the step is not in the workflow", async () => {
    const res = await appendStepPrompt(WID, "does-not-exist", UID, "x");
    expect(res).toBe("not_found");
  });
});
