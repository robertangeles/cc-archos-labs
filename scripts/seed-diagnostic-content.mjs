#!/usr/bin/env node
// Upserts the diagnostic_content row in site_setting from the canonical
// JSON at scripts/diagnostic-content.json. The JSON file is the
// source-of-truth committed to git; this script is the apply step.
//
// Safety: dev and prod currently share one DB. Default mode prints a
// structural diff vs the current row and waits for a typed `yes` before
// writing. Pass --yes to skip the prompt (for non-interactive contexts
// like CI). Pass --diff-only to print the diff and exit without writing
// regardless of confirmation.
//
// Run with:  pnpm db:seed-diagnostic-content [--yes] [--diff-only]
//
// Idempotent — safe to re-run. Never logs DATABASE_URL or the payload.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_PATH = resolve(__dirname, "diagnostic-content.json");
const SETTING_KEY = "diagnostic_content";

const FLAGS = new Set(process.argv.slice(2));
const SKIP_PROMPT = FLAGS.has("--yes");
const DIFF_ONLY = FLAGS.has("--diff-only");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Run via `pnpm db:seed-diagnostic-content` " +
      "so .env.local is loaded, or export DATABASE_URL in the shell.",
  );
  process.exit(1);
}

// Extract host for display so the operator can see which DB they're
// about to mutate. Never echo the full URL — it carries credentials.
function safeHostFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.host || "(unknown)";
  } catch {
    return "(unparseable)";
  }
}

let nextContent;
try {
  nextContent = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));
} catch (err) {
  console.error(`Failed to read ${CONTENT_PATH}: ${err.message}`);
  process.exit(1);
}

const requiredTopLevel = [
  "version",
  "questions",
  "riskFlagRules",
  "priorityTriggers",
  "tierBoundaries",
  "domainWeights",
];
for (const key of requiredTopLevel) {
  if (!(key in nextContent)) {
    console.error(`Content JSON is missing required top-level key: ${key}`);
    process.exit(1);
  }
}
if (!Array.isArray(nextContent.questions) || nextContent.questions.length === 0) {
  console.error("Content JSON: `questions` must be a non-empty array");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

async function main() {
  const existing = await sql`
    SELECT value FROM site_setting WHERE key = ${SETTING_KEY} LIMIT 1
  `;
  const currentContent = existing[0]?.value ?? null;

  const changes = diffContent(currentContent, nextContent);

  console.log("");
  console.log(`Target DB host: ${safeHostFromUrl(databaseUrl)}`);
  console.log(`Setting key:    ${SETTING_KEY}`);
  console.log("");

  if (changes.length === 0) {
    console.log("No changes detected. Nothing to apply.");
    return;
  }

  console.log(`Changes (${changes.length}):`);
  for (const line of changes) {
    console.log(`  ${line}`);
  }
  console.log("");

  if (DIFF_ONLY) {
    console.log("--diff-only set; exiting without writing.");
    return;
  }

  if (!SKIP_PROMPT) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Type 'yes' to apply, anything else to cancel: ")).trim();
    rl.close();
    if (answer !== "yes") {
      console.log("Cancelled. No write.");
      return;
    }
  }

  const result = await sql`
    INSERT INTO site_setting (key, value, created_at, updated_at)
    VALUES (${SETTING_KEY}, ${sql.json(nextContent)}, now(), now())
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
    `  version: ${nextContent.version}  questions: ${nextContent.questions.length}  ` +
      `risk rules: ${nextContent.riskFlagRules.length}  priority triggers: ${nextContent.priorityTriggers.length}`,
  );
}

try {
  await main();
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

// ----------------------------------------------------------------------------
// Diff — pragmatic, content-shape-specific. Surfaces the change classes
// that actually happen during calibration work: scores, question
// add/remove, risk rules add/remove, priority triggers add/remove, tier
// boundary tweaks, domain weight tweaks, version bumps. Label/text
// changes are reported but not value-printed (they get noisy fast).
// ----------------------------------------------------------------------------

function diffContent(current, next) {
  if (current === null) {
    return [`+ NEW ROW (no existing diagnostic_content in DB)`];
  }
  const out = [];

  if (current.version !== next.version) {
    out.push(`~ version: ${current.version} → ${next.version}`);
  }

  // Questions: keyed by id.
  const curQ = indexBy(current.questions ?? [], "id");
  const nxtQ = indexBy(next.questions ?? [], "id");
  const allQIds = unionKeys(curQ, nxtQ);
  for (const id of allQIds) {
    const a = curQ[id];
    const b = nxtQ[id];
    if (!a) {
      out.push(`+ question ${id} added (${b.options.length} options, domain=${b.domain})`);
      continue;
    }
    if (!b) {
      out.push(`- question ${id} removed`);
      continue;
    }
    // Both sides — compare fields.
    if (a.text !== b.text) out.push(`~ question ${id} text changed`);
    if (a.domain !== b.domain) out.push(`~ question ${id} domain: ${a.domain} → ${b.domain}`);
    if (a.block !== b.block) out.push(`~ question ${id} block: ${a.block} → ${b.block}`);
    if (stableStringify(a.branch) !== stableStringify(b.branch)) {
      out.push(`~ question ${id} branch trigger changed`);
    }
    // Options keyed by code.
    const aOpts = indexBy(a.options ?? [], "code");
    const bOpts = indexBy(b.options ?? [], "code");
    const allCodes = unionKeys(aOpts, bOpts);
    for (const code of allCodes) {
      const ao = aOpts[code];
      const bo = bOpts[code];
      if (!ao) {
        out.push(`+ question ${id} option ${code} added (score=${bo.score})`);
        continue;
      }
      if (!bo) {
        out.push(`- question ${id} option ${code} removed`);
        continue;
      }
      if (ao.score !== bo.score) {
        out.push(`~ question ${id} option ${code} score: ${ao.score} → ${bo.score}`);
      }
      if (ao.label !== bo.label) {
        out.push(`~ question ${id} option ${code} label changed`);
      }
    }
  }

  // Risk flag rules: keyed by code.
  const curR = indexBy(current.riskFlagRules ?? [], "code");
  const nxtR = indexBy(next.riskFlagRules ?? [], "code");
  for (const code of unionKeys(curR, nxtR)) {
    const a = curR[code];
    const b = nxtR[code];
    if (!a) {
      out.push(`+ risk rule ${code} added (severity=${b.severity})`);
      continue;
    }
    if (!b) {
      out.push(`- risk rule ${code} removed`);
      continue;
    }
    if (a.severity !== b.severity) {
      out.push(`~ risk rule ${code} severity: ${a.severity} → ${b.severity}`);
    }
    if (a.title !== b.title) out.push(`~ risk rule ${code} title changed`);
    if (a.body !== b.body) out.push(`~ risk rule ${code} body changed`);
    if (stableStringify(a.trigger) !== stableStringify(b.trigger)) {
      out.push(`~ risk rule ${code} trigger conditions changed`);
    }
  }

  // Priority triggers: keyed by `${questionId}:${answer}`.
  const curP = indexBy(current.priorityTriggers ?? [], (t) => `${t.questionId}:${t.answer}`);
  const nxtP = indexBy(next.priorityTriggers ?? [], (t) => `${t.questionId}:${t.answer}`);
  for (const key of unionKeys(curP, nxtP)) {
    const a = curP[key];
    const b = nxtP[key];
    if (!a) {
      out.push(`+ priority trigger ${key} added`);
      continue;
    }
    if (!b) {
      out.push(`- priority trigger ${key} removed`);
      continue;
    }
    if (a.reason !== b.reason) {
      out.push(`~ priority trigger ${key} reason changed`);
    }
  }

  // Tier boundaries: keyed by tier name.
  const curT = indexBy(current.tierBoundaries ?? [], "tier");
  const nxtT = indexBy(next.tierBoundaries ?? [], "tier");
  for (const tier of unionKeys(curT, nxtT)) {
    const a = curT[tier];
    const b = nxtT[tier];
    if (!a) {
      out.push(`+ tier ${tier} added (range ${b.min}–${b.max})`);
      continue;
    }
    if (!b) {
      out.push(`- tier ${tier} removed`);
      continue;
    }
    if (a.min !== b.min) out.push(`~ tier ${tier} min: ${a.min} → ${b.min}`);
    if (a.max !== b.max) out.push(`~ tier ${tier} max: ${a.max} → ${b.max}`);
    if (a.label !== b.label) out.push(`~ tier ${tier} label: ${a.label} → ${b.label}`);
  }

  // Domain weights: object with three numeric fields.
  const cw = current.domainWeights ?? {};
  const nw = next.domainWeights ?? {};
  for (const k of new Set([...Object.keys(cw), ...Object.keys(nw)])) {
    if (cw[k] !== nw[k]) {
      out.push(`~ domain weight ${k}: ${cw[k]} → ${nw[k]}`);
    }
  }

  return out;
}

function indexBy(arr, keyFnOrField) {
  const fn = typeof keyFnOrField === "function" ? keyFnOrField : (x) => x[keyFnOrField];
  const out = {};
  for (const item of arr) out[fn(item)] = item;
  return out;
}

function unionKeys(a, b) {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

// Key-order-independent JSON serialiser. Postgres jsonb does not
// preserve object key order across round-trips, so a naive
// JSON.stringify on a value loaded from jsonb diverges from the same
// value parsed from the source file even when content is identical.
// Used only inside diffContent for comparing nested objects/arrays.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}
