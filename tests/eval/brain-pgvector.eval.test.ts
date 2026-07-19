import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  captureToDb,
  recallFromDb,
  listMemoriesFromDb,
  deleteMemoryFromDb,
  deleteAllMemoriesFromDb,
  getMemoryStatusFromDb,
} from "@/lib/brain/memory";

// ============================================================================
// LIVE end-to-end proof of the in-app pgvector brain. Runs OUTSIDE CI (via
// `pnpm eval`) because it makes real OpenRouter embedding calls and hits the
// real DEV Postgres — the same reason the booking evals live here.
//
// It proves the two things a unit test / pglite cannot:
//   1. The real capture -> embed -> cosine-recall loop returns the right memory.
//   2. USER ISOLATION: user A's recall NEVER contains user B's memories, even
//      though both slices share one table. This is the guarantee the external
//      GBrain build nearly shipped broken (all clients shared one source).
//
// GUARD: refuses to run against anything but a local DEV database, so a
// misconfigured DATABASE_URL can never write test rows into PROD.
// ============================================================================

const url = process.env.DATABASE_URL ?? "";
const isLocalDev = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

let userA = "";
let userB = "";

async function createUser(tag: string): Promise<string> {
  const email = `brain-eval-${tag}-${Date.now()}@test.local`;
  const rows = (await getDb().execute(
    sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

beforeAll(async () => {
  if (!isLocalDev) return;
  userA = await createUser("a");
  userB = await createUser("b");
});

afterAll(async () => {
  if (!userA && !userB) return;
  // ON DELETE CASCADE removes every user_memory row for these users.
  await getDb().execute(
    sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`,
  );
});

describe("in-app pgvector brain (live)", () => {
  it("guards against running outside a local DEV database", () => {
    expect(
      isLocalDev,
      `Refusing to run: DATABASE_URL is not local DEV (host in ${url.replace(/:[^:@]+@/, ":***@")}).`,
    ).toBe(true);
  });

  it("captures, embeds, and recalls the right memory; isolates A from B", async () => {
    if (!isLocalDev) return;

    // Capture — real embeddings, real inserts.
    await captureToDb(
      userA,
      "We are migrating Westpac's customer data platform to a lakehouse this quarter",
    );
    await captureToDb(userA, "My name is Rob and I prefer concise, direct answers");
    await captureToDb(
      userB,
      "Our secret negotiated supplier rates are 40 percent below market",
    );

    // Status + listing reflect A's distilled facts (count varies by extraction).
    const statusA = await getMemoryStatusFromDb(userA);
    expect(statusA.hasMemory).toBe(true);
    expect((await listMemoriesFromDb(userA)).length).toBeGreaterThan(0);

    // Recall — A asks about the Westpac project; the relevant memory surfaces.
    const recallA = await recallFromDb(
      userA,
      "What do you know about my Westpac data project?",
    );
    expect(recallA.source).toBe("brain");
    expect(recallA.count).toBeGreaterThan(0);
    const aText = recallA.memories.join("\n").toLowerCase();
    expect(aText).toContain("westpac");

    // ISOLATION CANARY: A's recall must NEVER contain B's memory, regardless
    // of vector similarity — the WHERE user_id filter is the only thing
    // standing between two tenants sharing one table.
    expect(aText).not.toContain("supplier");
    expect(aText).not.toContain("40 percent");

    // B recalls its own memory and never sees A's.
    const recallB = await recallFromDb(userB, "supplier pricing rates");
    const bText = recallB.memories.join("\n").toLowerCase();
    expect(bText).toContain("supplier");
    expect(bText).not.toContain("westpac");
  });

  it("scopes delete to the owner (B cannot delete A's memory)", async () => {
    if (!isLocalDev) return;

    const listA = await listMemoriesFromDb(userA);
    const before = listA.length;
    expect(before).toBeGreaterThan(0);
    const target = listA[0].id;

    // Cross-user delete is a no-op and leaves A's data intact.
    expect(await deleteMemoryFromDb(userB, target)).toBe(false);
    expect((await listMemoriesFromDb(userA)).length).toBe(before);

    // Owner delete works.
    expect(await deleteMemoryFromDb(userA, target)).toBe(true);
    expect((await listMemoriesFromDb(userA)).length).toBe(before - 1);

    // Bulk delete clears the rest.
    expect(await deleteAllMemoriesFromDb(userA)).toBeGreaterThan(0);
    expect((await getMemoryStatusFromDb(userA)).hasMemory).toBe(false);
  });
});
