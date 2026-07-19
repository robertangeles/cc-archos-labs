// Backfill existing GBrain memories into the in-app user_memory (pgvector)
// table, so no user experiences "Metis forgot me" at cutover.
//
// For each provisioned user (a user_brain row), this fetches their GBrain
// pages over MCP, distills each page into clean atomic facts (extract +
// consolidate, same as live capture), and stores those in user_memory.
//
//   Dry-run (default, writes nothing):
//     node --env-file=.env.local --conditions=react-server --import tsx \
//       scripts/backfill-brain-to-pgvector.ts
//
//   Apply:  add --apply
//   Re-backfill users who already have rows:  add --force
//
// TWO-DB DISCIPLINE: the script targets whatever DATABASE_URL points at.
// `.env.local` = DEV. To backfill PROD, run with DATABASE_URL set to the
// Render PROD URL, AFTER a pg_dump backup (see
// wiki/entities/deployment-architecture.md). Integration config (gbrainUrl +
// admin token) is read from the same DB, so PROD reads PROD's GBrain config.
//
// Idempotent: users who already have user_memory rows are skipped unless
// --force is passed, so a re-run after a partial failure is safe.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userBrain, userMemory } from "@/lib/db/schema";
import { getBrainToken } from "@/lib/brain/provision";
import { callMcp } from "@/lib/brain/client";
import { extractFacts, consolidateAndApply } from "@/lib/brain/distill";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const MAX_BODY_CHARS = 8000;

interface PageMeta {
  slug: string;
  title?: string;
  updated_at?: string;
}

// The GBrain MCP tools return their JSON payload as text inside a `content`
// array — the same shape the /api/brain/memories route parses.
function parseList(result: unknown): PageMeta[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return [];
  for (const item of r.content) {
    if (typeof item === "object" && item !== null && "text" in item) {
      try {
        const parsed = JSON.parse((item as { text: string }).text);
        if (Array.isArray(parsed)) return parsed as PageMeta[];
      } catch {
        continue;
      }
    }
  }
  return [];
}

function parseContent(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return null;
  for (const item of r.content) {
    if (typeof item === "object" && item !== null && "text" in item) {
      const text = (item as { text: string }).text;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.compiled_truth === "string" && parsed.compiled_truth) {
          return parsed.compiled_truth;
        }
        if (typeof parsed.content === "string") {
          return parsed.content.replace(/^---[\s\S]*?---\n*/, "").trim();
        }
      } catch {
        return text;
      }
    }
  }
  return null;
}

async function fetchPages(
  userId: string,
): Promise<Array<{ title: string | null; body: string }>> {
  const token = await getBrainToken(userId);
  if (!token) return [];
  const listResp = await callMcp(token, "list_pages", { limit: 500 });
  if (listResp.error) return [];
  const metas = parseList(listResp.result);
  const pages: Array<{ title: string | null; body: string }> = [];
  for (const meta of metas) {
    let body = meta.title ?? meta.slug;
    try {
      const pageResp = await callMcp(token, "get_page", { slug: meta.slug }, 8000);
      body = parseContent(pageResp.result) ?? body;
    } catch {
      // Fall back to the title/slug we already have.
    }
    pages.push({ title: meta.title?.slice(0, 120) ?? null, body });
  }
  return pages;
}

async function main() {
  const db = getDb();
  const brains = await db
    .select({ userId: userBrain.userId })
    .from(userBrain);
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} — ${brains.length} provisioned brain(s) found.\n`,
  );

  let usersMigrated = 0;
  let memoriesMigrated = 0;
  let usersSkipped = 0;
  let embedFailures = 0;

  for (const { userId } of brains) {
    const existing = await db
      .select({ id: userMemory.id })
      .from(userMemory)
      .where(eq(userMemory.userId, userId))
      .limit(1);
    if (existing.length > 0 && !FORCE) {
      usersSkipped++;
      continue;
    }

    const pages = await fetchPages(userId);
    if (pages.length === 0) continue;
    console.log(`user ${userId}: ${pages.length} page(s)`);
    if (!APPLY) continue;

    for (const page of pages) {
      const body = page.body.slice(0, MAX_BODY_CHARS);
      if (!body.trim()) continue;
      try {
        // Distill each GBrain page into clean facts + consolidate, so
        // migrated memories land in the new format — not as raw pages.
        const facts = await extractFacts(body);
        if (facts.length === 0) continue;
        await consolidateAndApply(userId, facts, null);
        memoriesMigrated += facts.length;
      } catch {
        console.warn(`  distill failed — skipped one page for ${userId}`);
        embedFailures++;
      }
    }
    usersMigrated++;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN COMPLETE"}: ` +
      `users=${usersMigrated} memories=${memoriesMigrated} ` +
      `skipped(already had rows)=${usersSkipped} embedFailures=${embedFailures}`,
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("BACKFILL FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
