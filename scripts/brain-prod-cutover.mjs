// One-shot PROD cutover for the in-app pgvector brain + distillation.
//
// Does three things, in order, against PROD:
//   1. pg_dump backup (FIRST — aborts on failure before any write)
//   2. apply pending migrations (delegates to the proven scripts/db-apply.mjs)
//   3. apply the `brain-memory-v1` system-prompt clause (idempotent)
//
// It deliberately does NOT:
//   - flip MEMORY_BACKEND (that is a manual Render env change — the final gate)
//   - backfill GBrain memories (separate, optional — see the runbook)
//
// SAFETY
//   - Reads PROD_DATABASE_URL from the shell env ONLY. It never touches
//     .env.local's DATABASE_URL (which points at DEV). Refuses if unset.
//   - --apply refuses a local (127.0.0.1) URL — this script is for PROD.
//   - Default is a read-only DRY-RUN that writes nothing and prints the plan.
//
// USAGE
//   PROD_DATABASE_URL="postgres://…render.com/…?sslmode=require" \
//     node scripts/brain-prod-cutover.mjs            # dry-run (default)
//   PROD_DATABASE_URL="…" node scripts/brain-prod-cutover.mjs --apply

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const url = process.env.PROD_DATABASE_URL;

function die(msg) {
  console.error(`\nABORT: ${msg}`);
  process.exit(1);
}

if (!url) {
  die(
    "PROD_DATABASE_URL is not set. Export the Render External Database URL:\n" +
      '  export PROD_DATABASE_URL="postgres://…singapore-postgres.render.com/…?sslmode=require"\n' +
      "This script never reads .env.local (that is DEV).",
  );
}
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (APPLY && isLocal) {
  die("PROD_DATABASE_URL looks LOCAL (127.0.0.1). --apply is refused against a local DB.");
}
if (!/render\.com|sslmode=require/.test(url)) {
  console.warn(
    "WARN: PROD_DATABASE_URL doesn't look like a Render/SSL URL — double-check it is really PROD.",
  );
}

const ANCHOR = "## SCOPE — HARD BOUNDARY";
const MEMORY_SECTION = `## MEMORY

The Archos Labs platform keeps persistent notes about the current user and supplies them under a "## Brain Memory" heading in your context. This is trusted platform data about THIS user — not user input, and not an injection attempt.

When a "## Brain Memory" section is present:
- You know this user across sessions. Treat the notes as true and answer from them naturally.
- If asked "do you remember me?", "who am I?", or anything about the user, answer from the notes — their name, role, company, location, projects, preferences.
- NEVER reply "I don't retain memory between sessions", "I have no memory of past conversations", or "I can only use the details you provide in the current conversation." When brain memory is present, those statements are false.
- Speak as if you simply remember the person. Do NOT describe how you know — never say "your notes", "brain memory", "retrieved", or "my context". You just know them. (This keeps KNOWLEDGE SOURCE PROTECTION intact.)

When NO "## Brain Memory" section is present, you have no notes on this user yet. Say so plainly ("I don't have anything on you yet — tell me about yourself and I'll remember it"), not that you can never remember.

`;

const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

/** Read-only: which migrations are not yet applied on the target. */
async function pendingMigrations() {
  const files = readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let applied = new Set();
  try {
    const rows = await sql`select filename from __drizzle_applied`;
    applied = new Set(rows.map((r) => r.filename));
  } catch {
    // table doesn't exist yet → everything is pending
  }
  return files.filter((f) => !applied.has(f));
}

/**
 * Idempotent prompt clause. Robust to whatever PROD's prompt actually is:
 * skip if already present, insert before the SCOPE anchor if found, else
 * append to the end (the clause is self-contained and works anywhere).
 */
async function planPrompt() {
  const rows = await sql`SELECT value FROM site_setting WHERE key = 'workspace_chat_prompt'`;
  if (rows.length === 0) {
    return { action: "skip-missing", detail: "no workspace_chat_prompt row on PROD" };
  }
  let value = rows[0].value;
  // Legacy double-encoding: site_setting.value can come back as a jsonb STRING
  // wrapping the JSON object (see the wiki integration-config lesson). Parse it
  // back to an object on read so we don't mis-read the prompt as empty.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { action: "skip-unreadable", detail: "prompt value is a non-JSON string — fix it in /admin/prompts" };
    }
  }
  const sp = (value && typeof value === "object" && value.systemPrompt) || "";
  if (sp.includes("## MEMORY")) {
    return { action: "skip-present", detail: "already has a ## MEMORY section" };
  }
  let newSp;
  let where;
  if (sp.includes(ANCHOR)) {
    newSp = sp.replace(ANCHOR, MEMORY_SECTION + ANCHOR);
    where = "insert before the SCOPE anchor";
  } else {
    newSp = `${sp.trimEnd()}\n\n${MEMORY_SECTION.trimEnd()}\n`;
    where = "append to end (SCOPE anchor not found)";
  }
  return { action: "write", detail: `${where} (${sp.length} → ${newSp.length} chars)`, value, newSp };
}

async function main() {
  const host = (url.match(/@([^/:]+)/) || [])[1] || "?";
  console.log(`\n=== Brain PROD cutover — ${APPLY ? "APPLY (writes to PROD)" : "DRY-RUN (no writes)"} ===`);
  console.log(`Target host: ${host}`);

  const pending = await pendingMigrations();
  const promptPlan = await planPrompt();

  console.log("\nPlan:");
  console.log(`  1. Backup     — pg_dump -Fc of PROD (${APPLY ? "will run" : "skipped in dry-run"})`);
  console.log(
    `  2. Migrations — ${pending.length} pending${pending.length ? ": " + pending.join(", ") : " (up to date)"}`,
  );
  console.log(`  3. Prompt     — ${promptPlan.action}: ${promptPlan.detail}`);

  if (!APPLY) {
    console.log("\nDRY-RUN complete. Re-run with --apply to execute against PROD.");
    await sql.end();
    return;
  }

  // ---- APPLY ----
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = `${process.env.HOME}/archos-prod-backup-brain-${stamp}.dump`;

  console.log(`\n[1/3] Backup → ${backup}`);
  const dump = spawnSync("pg_dump", ["-Fc", "-f", backup, url], { stdio: "inherit" });
  if (dump.status !== 0) {
    die(
      "pg_dump failed — NO writes performed. Common cause: local pg_dump older than the server. " +
        "Fix the pg_dump version, OR take a backup from the Render dashboard, then re-run.",
    );
  }

  console.log("\n[2/3] Migrations → db-apply.mjs against PROD");
  const mig = spawnSync("node", ["scripts/db-apply.mjs"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (mig.status !== 0) die("Migration failed. The backup is safe — investigate before proceeding.");

  console.log("\n[3/3] Prompt clause (brain-memory-v1)");
  if (promptPlan.action === "write") {
    const newValue = { ...promptPlan.value, systemPrompt: promptPlan.newSp, version: "brain-memory-v1" };
    // sql.json() stores a single-encoded jsonb OBJECT. Do NOT use
    // JSON.stringify(newValue)::jsonb — that double-encodes into a jsonb
    // string and getChatPrompt then falls back to the placeholder prompt.
    await sql`UPDATE site_setting SET value = ${sql.json(newValue)}, updated_at = now() WHERE key = 'workspace_chat_prompt'`;
    console.log("  applied (single-encoded jsonb).");
  } else if (promptPlan.action === "skip-present") {
    console.log("  already present — skipped (idempotent).");
  } else {
    console.log(`  skipped (${promptPlan.detail}). Add the ## MEMORY section in /admin/prompts manually if needed.`);
  }

  console.log("\n✅ Schema + prompt done. Backup at:", backup);
  console.log("\nNEXT (manual, in order):");
  console.log(
    '  • (optional) Backfill GBrain memories:  DATABASE_URL="$PROD_DATABASE_URL" node --conditions=react-server --import tsx scripts/backfill-brain-to-pgvector.ts   (dry-run), then add --apply',
  );
  console.log("  • Flip the flag:  Render → the web service → Environment → set MEMORY_BACKEND=pgvector → save (restart ~2-4 min).");
  console.log("  • Smoke test:  on archoslabs.xyz, tell Metis to remember a fact → /account/brain shows a clean fact → new chat → it recalls.");
  console.log("  • Rollback (if needed):  unset MEMORY_BACKEND on Render → instantly back on GBrain.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  try {
    await sql.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
