import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  ingestEntity,
  deactivateEntityMemory,
} from "@/lib/brain/workspace-ingest";
import { recallWorkspaceFromDb } from "@/lib/brain/memory";

// ============================================================================
// LIVE org-isolation proof for the workspace_memory shared tier. Runs OUTSIDE
// CI (via `pnpm eval`) because it makes real OpenRouter embedding calls and
// hits the real DEV Postgres — the same reason the brain-pgvector eval lives
// here.
//
// It proves the guarantee the shared tier exists to keep:
//   1. Ingest -> embed -> cosine-recall returns the right org's facts.
//   2. ORG ISOLATION: org A's recall NEVER contains org B's workspace facts,
//      even when both orgs hold a fact for the SAME source_entity_id — the
//      three-way (organisation_id, source_type, source_entity_id) predicate is
//      the only thing standing between two tenants sharing one table.
//
// GUARD: refuses to run against anything but a local DEV database, so a
// misconfigured DATABASE_URL can never write test rows into PROD.
// ============================================================================

const url = process.env.DATABASE_URL ?? "";
const isLocalDev = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

let ownerId = "";
let orgA = "";
let orgB = "";

async function createUser(): Promise<string> {
  const email = `wm-iso-eval-${Date.now()}@test.local`;
  const rows = (await getDb().execute(
    sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

async function createOrg(tag: string): Promise<string> {
  const uniq = `${tag}-${Date.now()}`;
  const rows = (await getDb().execute(
    sql`INSERT INTO organisation (name, slug, join_key, owner_id)
        VALUES (${"WM " + tag}, ${"wm-" + uniq}, ${"key-" + uniq}, ${ownerId}::uuid)
        RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

beforeAll(async () => {
  if (!isLocalDev) return;
  process.env.WORKSPACE_MEMORY_INGEST = "true";
  ownerId = await createUser();
  orgA = await createOrg("a");
  orgB = await createOrg("b");
});

afterAll(async () => {
  if (!isLocalDev) return;
  // ON DELETE CASCADE removes every workspace_memory row for these orgs.
  if (orgA || orgB) {
    await getDb().execute(
      sql`DELETE FROM organisation WHERE id IN (${orgA}, ${orgB})`,
    );
  }
  if (ownerId) {
    await getDb().execute(sql`DELETE FROM users WHERE id = ${ownerId}`);
  }
  delete process.env.WORKSPACE_MEMORY_INGEST;
});

describe("workspace_memory org isolation (live)", () => {
  it("guards against running outside a local DEV database", () => {
    expect(
      isLocalDev,
      `Refusing to run: DATABASE_URL is not local DEV (host in ${url.replace(/:[^:@]+@/, ":***@")}).`,
    ).toBe(true);
  });

  it("ingests + recalls per org; isolates A from B", async () => {
    if (!isLocalDev) return;

    await ingestEntity({
      orgId: orgA,
      sourceType: "project",
      sourceEntityId: crypto.randomUUID(),
      body: "Project Westpac lakehouse migration is active.",
    });
    await ingestEntity({
      orgId: orgB,
      sourceType: "project",
      sourceEntityId: crypto.randomUUID(),
      body: "Project Globex secret supplier-rate negotiation is active.",
    });

    const recA = (
      await recallWorkspaceFromDb(orgA, "What is my Westpac project?")
    )
      .join("\n")
      .toLowerCase();
    expect(recA).toContain("westpac");
    // ISOLATION CANARY: A's recall must NEVER contain B's fact.
    expect(recA).not.toContain("globex");
    expect(recA).not.toContain("supplier");

    const recB = (await recallWorkspaceFromDb(orgB, "supplier-rate negotiation"))
      .join("\n")
      .toLowerCase();
    expect(recB).toContain("globex");
    expect(recB).not.toContain("westpac");
  });

  it("deactivate is org-scoped even for a shared source_entity_id", async () => {
    if (!isLocalDev) return;

    // Same entity id in BOTH orgs — the hardest isolation case.
    const eid = crypto.randomUUID();
    await ingestEntity({
      orgId: orgA,
      sourceType: "client",
      sourceEntityId: eid,
      body: "Client Acme operates in healthcare.",
    });
    await ingestEntity({
      orgId: orgB,
      sourceType: "client",
      sourceEntityId: eid,
      body: "Client Beta operates in finance.",
    });

    // Deactivating org A's entity must NOT touch org B's fact for the same id.
    await deactivateEntityMemory({
      orgId: orgA,
      sourceType: "client",
      sourceEntityId: eid,
    });

    const recA = (await recallWorkspaceFromDb(orgA, "healthcare client"))
      .join("\n")
      .toLowerCase();
    expect(recA).not.toContain("acme"); // A's fact was deactivated

    const recB = (await recallWorkspaceFromDb(orgB, "finance client"))
      .join("\n")
      .toLowerCase();
    expect(recB).toContain("beta"); // B's fact (same entity id) untouched
  });
});
