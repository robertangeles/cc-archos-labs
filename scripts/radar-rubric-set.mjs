// Append a new news-radar rubric version. The rubric (Jev model pin, scored
// questions, cut-offs T/C/M/N) is frozen per version: a change means a NEW
// version, which starts a new cohort and restarts the 7-day gate window.
//
// Usage:
//   node --env-file=.env.local --no-warnings scripts/radar-rubric-set.mjs <config.json> [--dry-run]
//
// --dry-run validates and prints, and never touches the database.
// Otherwise it inserts one news_radar_rubric row (the version is a database
// identity: strictly increasing, cannot be chosen) and prints what to do next.
//
// Imports the validator straight from lib/news-radar/rubric.ts under Node's type
// stripping, so the CLI and the radar can never disagree about what is valid.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { parseRubricConfig } from "../lib/news-radar/rubric.ts";

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function readRubricFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Cannot read ${path}.`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  try {
    return parseRubricConfig(json);
  } catch (err) {
    const issues = (err.issues ?? []).map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`Invalid rubric:\n${issues.join("\n")}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    fail("Usage: radar-rubric-set.mjs <config.json> [--dry-run]");
  }

  let config;
  try {
    config = readRubricFile(path);
  } catch (err) {
    fail(err.message);
  }

  const c = config.cutoffs;
  console.log(`Rubric valid: model ${config.model}, questions: ${Object.keys(config.questions).join(", ")}`);
  console.log(
    `Cut-offs: audience fit >= ${c.audienceFit}, confidence >= ${c.confidence}, ` +
      `novelty distance >= ${c.minNoveltyDistance}, show ${c.dailyCap} per day`,
  );
  if (dryRun) {
    console.log("Dry run: nothing written.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL not set.");
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`Target database host: ${host} (${isLocal ? "LOCAL" : "REMOTE"})`);

  const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });
  try {
    const [row] = await sql`
      insert into news_radar_rubric (config) values (${sql.json(config)})
      returning version`;
    console.log(`\nAppended rubric version ${row.version}.`);
    console.log(
      "\nNext steps (see wiki/runbooks/news-radar-runbook.md):\n" +
        "  Warm-up version: leave it running a few days to prove the feed, key, claims and\n" +
        "    monitoring. It is excluded from the gate.\n" +
        "  Evaluation version: create it AFTER the Radar page is live, monitoring is verified\n" +
        "    and the claim smoke is done. The 7-day window starts with it; the gate report\n" +
        `    is run with --version ${row.version}.`,
    );
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => fail(`Failed: ${err.message}`));
}
