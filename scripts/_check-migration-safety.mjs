// Scans Drizzle migration files added on this branch for destructive
// SQL — DROP TABLE / DROP COLUMN / TRUNCATE / DELETE FROM (without
// WHERE) / ALTER TABLE ... DROP. Surfaces these as a class of risk
// because of the 2026-05-12 incident where Dev2's drift audit dropped
// a table that origin/main was still using.
//
// Modes:
//   --warn-only   Print findings, always exit 0. Used by the Husky
//                 pre-push hook so a push isn't blocked locally.
//   --ci          Print findings; exit 2 if anything destructive is
//                 found UNLESS the PR has the `migration-destructive`
//                 label OR the migration file's first non-blank line
//                 is a `-- safety: …` comment that opts in explicitly.
//                 (default if invoked without args)
//
// Exit codes:
//   0   no destructive ops, OR override is in place
//   1   tool error (couldn't find files, etc.)
//   2   destructive ops detected and no override (CI fails)

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] === "--warn-only" ? "warn-only" : "ci";

const DESTRUCTIVE_PATTERNS = [
  { re: /\bDROP\s+TABLE\b/i, label: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, label: "DROP COLUMN" },
  { re: /\bDROP\s+INDEX\b/i, label: "DROP INDEX" },
  { re: /\bDROP\s+CONSTRAINT\b/i, label: "DROP CONSTRAINT" },
  { re: /\bTRUNCATE\s+(TABLE\s+)?/i, label: "TRUNCATE" },
  { re: /\bALTER\s+TABLE\s+[^\s]+\s+DROP\b/i, label: "ALTER TABLE ... DROP" },
  // DELETE FROM without a WHERE clause — full-table wipe. DELETE WHERE
  // is allowed; it's targeted data work and is its own choice.
  { re: /\bDELETE\s+FROM\s+[^\s;]+\s*;/i, label: "DELETE FROM (no WHERE)" },
];

// Files added on this branch but NOT on origin/main are the ones the
// new PR introduces — those are what we want to scan. Migrations
// already on main are out of scope (they've been merged and reviewed).
function listAddedMigrations() {
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" });
  } catch {
    // Offline or no remote — fall through and scan all migrations as
    // a defensive default. Better to flag false positives than miss
    // destructive ops.
  }

  try {
    const raw = execSync(
      "git diff --name-status --diff-filter=A origin/main...HEAD -- drizzle/",
      { encoding: "utf8" },
    );
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.split(/\s+/).pop())
      .filter((p) => p && p.endsWith(".sql"));
  } catch {
    // No origin/main reference available (fresh clone, weird state).
    // Fall back to listing every .sql under drizzle/.
    return safeListDrizzleSql();
  }
}

function safeListDrizzleSql() {
  try {
    return readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join("drizzle", f));
  } catch {
    return [];
  }
}

function scanFile(path) {
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return { path, findings: [], opt_in: false, readError: true };
  }

  // Opt-in: first non-blank, non-leading-whitespace line is a SQL
  // comment matching `-- safety: verified against origin/main …`
  const firstNonBlank =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const optIn = /^--\s*safety:\s*verified against origin\/main/i.test(
    firstNonBlank,
  );

  // Strip SQL line comments and block comments before pattern-matching
  // so a `-- DROP TABLE foo` doesn't false-fire. Pattern is simple:
  // remove `/* ... */` non-greedy, then everything after `--` on each
  // line.
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  const findings = [];
  for (const { re, label } of DESTRUCTIVE_PATTERNS) {
    if (re.test(stripped)) findings.push(label);
  }

  return { path, findings, opt_in: optIn, readError: false };
}

const addedMigrations = listAddedMigrations();

if (addedMigrations.length === 0) {
  // Nothing added on this branch — green.
  if (mode === "warn-only") process.exit(0);
  console.log("Migration safety: no migrations added on this branch. OK.");
  process.exit(0);
}

const results = addedMigrations.map(scanFile);
const flagged = results.filter((r) => r.findings.length > 0);

if (flagged.length === 0) {
  if (mode === "warn-only") process.exit(0);
  console.log(
    `Migration safety: ${addedMigrations.length} new migration(s) scanned, no destructive ops detected.`,
  );
  process.exit(0);
}

// Print findings.
const banner = mode === "warn-only" ? "WARNING" : "ERROR";
console.error("");
console.error(`[${banner}] Destructive migration operations detected.`);
console.error("");
for (const r of flagged) {
  console.error(`  ${r.path}`);
  for (const f of r.findings) {
    console.error(`    - ${f}`);
  }
  if (r.opt_in) {
    console.error(`    (opt-in comment present — would be allowed in CI)`);
  }
}
console.error("");
console.error(
  "Before merging a destructive migration, verify that no other branch / live",
);
console.error(
  "deployment depends on the structures being dropped. See:",
);
console.error(
  "  wiki/lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md",
);
console.error("");
console.error("Two override mechanisms (CI accepts either):");
console.error(
  '  1. Add the GitHub label "migration-destructive" to the PR.',
);
console.error(
  '  2. Add this comment as the first line of the migration .sql file:',
);
console.error(
  '       -- safety: verified against origin/main on YYYY-MM-DD by <name>',
);
console.error("");

if (mode === "warn-only") {
  // Pre-push: print but don't block — let the user push and see CI's
  // verdict (which has access to the GitHub label override).
  process.exit(0);
}

// CI mode: check the override paths.
const allOptedInViaComment = flagged.every((r) => r.opt_in);
const hasLabelOverride = ciHasDestructiveLabel();

if (allOptedInViaComment || hasLabelOverride) {
  console.error(
    "Override in place — migration safety check is passing this run.",
  );
  if (hasLabelOverride) {
    console.error('  (`migration-destructive` label on PR)');
  }
  if (allOptedInViaComment) {
    console.error('  (`-- safety: verified` comment on every flagged file)');
  }
  console.error("");
  process.exit(0);
}

console.error(
  "No override in place. Add the label or the comment, then re-run CI.",
);
console.error("");
process.exit(2);

// ---------------------------------------------------------------------------
// CI helpers
// ---------------------------------------------------------------------------

function ciHasDestructiveLabel() {
  // Only meaningful in a GitHub Actions pull_request context. Outside
  // that context we conservatively say "no label" so a local --ci run
  // still flags destructive ops loudly.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return false;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const labels = event?.pull_request?.labels ?? [];
    return labels.some(
      (l) => typeof l?.name === "string" && l.name === "migration-destructive",
    );
  } catch {
    return false;
  }
}
