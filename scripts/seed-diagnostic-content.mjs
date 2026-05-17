#!/usr/bin/env node
// Upserts the diagnostic_content row in site_setting from the canonical
// JSON at scripts/diagnostic-content.json. The JSON file is the
// source-of-truth committed to git; this script is the apply step.
//
// Run with:  pnpm db:seed-diagnostic-content
// (or: node --env-file=.env.local scripts/seed-diagnostic-content.mjs)
//
// Idempotent — safe to re-run. Never logs DATABASE_URL or the payload.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_PATH = resolve(__dirname, "diagnostic-content.json");
const SETTING_KEY = "diagnostic_content";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Run via `pnpm db:seed-diagnostic-content` " +
      "so .env.local is loaded, or export DATABASE_URL in the shell.",
  );
  process.exit(1);
}

let content;
try {
  content = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));
} catch (err) {
  console.error(`Failed to read ${CONTENT_PATH}: ${err.message}`);
  process.exit(1);
}

// Light shape sanity check — catches the most likely human errors
// (missing top-level key, wrong type) before we hit the DB. Full Zod
// validation runs on /admin/diagnostic save and on every runtime load
// in lib/diagnostic/content-config.ts, so this stays minimal.
const required = [
  "version",
  "questions",
  "riskFlagRules",
  "priorityTriggers",
  "tierBoundaries",
  "domainWeights",
];
for (const key of required) {
  if (!(key in content)) {
    console.error(`Content JSON is missing required top-level key: ${key}`);
    process.exit(1);
  }
}
if (!Array.isArray(content.questions) || content.questions.length === 0) {
  console.error("Content JSON: `questions` must be a non-empty array");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

try {
  const result = await sql`
    INSERT INTO site_setting (key, value, created_at, updated_at)
    VALUES (${SETTING_KEY}, ${sql.json(content)}, now(), now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
    RETURNING key, updated_at
  `;

  const row = result[0];
  console.log(
    `Upserted site_setting key='${row.key}' updated_at=${row.updated_at.toISOString()}`,
  );
  console.log(
    `  version: ${content.version}  questions: ${content.questions.length}  ` +
      `risk rules: ${content.riskFlagRules.length}  priority triggers: ${content.priorityTriggers.length}`,
  );
} catch (err) {
  console.error("Upsert failed:", err.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
