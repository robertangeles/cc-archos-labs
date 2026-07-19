import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  captureToDb,
  listMemoriesFromDb,
  recallFromDb,
} from "@/lib/brain/memory";

// ============================================================================
// LIVE end-to-end proof of the distillation layer. Runs OUTSIDE CI (via
// `pnpm eval`) — real OpenRouter extract + judge + embed calls against the DEV
// Postgres. Proves what the unit tests can't:
//   1. Capture stores CLEAN atomic facts, not raw "## User / ## Assistant" turns.
//   2. DEDUP: saying the same thing twice does not create a duplicate fact.
//   3. SUPERSEDE: a changed preference deactivates the old fact (soft-delete),
//      and recall returns only the new value.
//   4. Greetings/small-talk store nothing.
//
// GUARD: refuses to run against anything but a local DEV database.
// ============================================================================

const url = process.env.DATABASE_URL ?? "";
const isLocalDev = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

let userId = "";

async function activeCount(): Promise<number> {
  const rows = (await getDb().execute(
    sql`SELECT count(*)::int n FROM user_memory WHERE user_id = ${userId}::uuid AND is_active`,
  )) as unknown as Array<{ n: number }>;
  return rows[0].n;
}
async function supersededCount(): Promise<number> {
  const rows = (await getDb().execute(
    sql`SELECT count(*)::int n FROM user_memory WHERE user_id = ${userId}::uuid AND is_active = false`,
  )) as unknown as Array<{ n: number }>;
  return rows[0].n;
}
const activeText = async () =>
  (await listMemoriesFromDb(userId)).map((m) => m.content).join(" \n ").toLowerCase();

beforeAll(async () => {
  if (!isLocalDev) return;
  const rows = (await getDb().execute(
    sql`INSERT INTO users (email) VALUES (${`brain-distill-${Date.now()}@test.local`}) RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  userId = rows[0].id;
});

afterAll(async () => {
  if (!userId) return;
  await getDb().execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

describe("distillation layer (live)", () => {
  it("guards against running outside a local DEV database", () => {
    expect(isLocalDev, "DATABASE_URL must be local DEV to run this eval").toBe(true);
  });

  it("stores clean facts (not raw turns)", async () => {
    if (!isLocalDev) return;
    await captureToDb(
      userId,
      "My name is Zephyr Quill and I founded Cogwheel, a widget-analytics startup based in Perth.",
    );
    const text = await activeText();
    expect(await activeCount()).toBeGreaterThan(0);
    expect(text).toContain("zephyr"); // extracted the identity
    expect(text).not.toContain("## user"); // NOT a raw turn dump
    expect(text).not.toContain("## assistant");
  });

  it("dedupes — the same statement twice does not duplicate", async () => {
    if (!isLocalDev) return;
    const before = await activeCount();
    await captureToDb(
      userId,
      "My name is Zephyr Quill and I founded Cogwheel, a widget-analytics startup based in Perth.",
    );
    expect(await activeCount()).toBe(before); // no new rows
  });

  it("supersedes a changed preference (old goes inactive, recall returns new)", async () => {
    if (!isLocalDev) return;
    await captureToDb(userId, "My preferred data management framework is DMBOK.");
    expect(await activeText()).toContain("dmbok");
    const supersededBefore = await supersededCount();

    await captureToDb(
      userId,
      "I've switched my preferred data management framework from DMBOK to DCAM.",
    );
    const text = await activeText();
    expect(text).toContain("dcam");
    expect(text, "old DMBOK fact must be superseded, not left active").not.toContain("dmbok");
    expect(
      await supersededCount(),
      "the DMBOK fact should be soft-deleted, not hard-deleted",
    ).toBeGreaterThan(supersededBefore);

    const recall = await recallFromDb(userId, "what data framework do I prefer?");
    expect(recall.source).toBe("brain");
    expect(recall.memories.join(" ").toLowerCase()).toContain("dcam");
  });

  it("ignores greetings / small talk", async () => {
    if (!isLocalDev) return;
    const before = await activeCount();
    await captureToDb(userId, "hey there, how's it going today?");
    expect(await activeCount()).toBe(before); // nothing stored
  });
});
