// Reminds the developer to run `pnpm eval` when a PR touches LLM-
// adjacent or retrieval-adjacent code. The eval suites under
// tests/eval/ make live Claude + OpenRouter calls (cost ~$0.02/run)
// and catch regressions that unit tests can't — prompt drift, model
// swaps, embedding-shape changes, editorial drift in posts.
//
// This script is a REMINDER, not a gate. Both modes always exit 0.
// The eval bench requires credentials in the integration-config DB
// + live API calls, so it can't run inside CI itself (per the
// 'secrets stay in DB' architecture — see PR #93). The pre-push and
// CI runs surface the reminder; the developer chooses whether to
// run `pnpm eval` locally.
//
// Modes:
//   --warn-only   Pre-push hook. Prints if eval is recommended; exit 0.
//   --ci          CI step. Same content; prints inside the GitHub
//                 Actions log so the PR author + reviewers see it
//                 in the workflow output. Exit 0.

import { execSync } from "node:child_process";

const mode = process.argv[2] === "--ci" ? "ci" : "warn-only";

// File patterns that warrant a `pnpm eval` run. Each entry: a path
// prefix or exact match, plus a short reason that appears in the
// reminder so the developer knows WHY this file triggered the alert.
const SENSITIVE_PATHS = [
  { path: "lib/claude.ts", reason: "Claude wrapper (generateStructured)" },
  { path: "lib/embeddings.ts", reason: "Embedding helper (ANN inputs)" },
  { path: "lib/posts/find-similar.ts", reason: "Shared ANN primitive" },
  { path: "lib/posts/gloss.ts", reason: "Gloss LLM call" },
  { path: "lib/post-gloss.ts", reason: "Gloss prompt loader" },
  { path: "lib/post-gloss-shared.ts", reason: "Gloss starter prompt" },
  { path: "lib/booking-prompts.ts", reason: "Booking prompt loader" },
  { path: "lib/booking-prompts-shared.ts", reason: "Booking starter prompts" },
  { path: "lib/claude-booking.ts", reason: "Booking LLM calls" },
  { path: "lib/diagnostic/recommend.ts", reason: "Per-action retrieval pipeline" },
  { path: "lib/diagnostic/prompts.ts", reason: "Diagnostic user-prompt builder" },
  { path: "lib/diagnostic/prompt-config.ts", reason: "Diagnostic prompt loader" },
  { path: "lib/diagnostic/prompt-config-shared.ts", reason: "Diagnostic starter prompt" },
  { path: "lib/integration-config.ts", reason: "LLM API key + model id resolution" },
  { path: "lib/integration-config-shared.ts", reason: "Integration config schema" },
];

// Map sensitive files → which eval suite(s) cover them. Lets us
// recommend a targeted run instead of the full bench when only one
// surface is touched.
const SUITE_HINTS = {
  "lib/claude.ts": ["all 5 suites"],
  "lib/embeddings.ts": [
    "tests/eval/recommend.eval.test.ts",
    "tests/eval/gloss.eval.test.ts",
  ],
  "lib/posts/find-similar.ts": ["tests/eval/recommend.eval.test.ts"],
  "lib/posts/gloss.ts": ["tests/eval/gloss.eval.test.ts"],
  "lib/post-gloss.ts": ["tests/eval/gloss.eval.test.ts"],
  "lib/post-gloss-shared.ts": ["tests/eval/gloss.eval.test.ts"],
  "lib/booking-prompts.ts": [
    "tests/eval/blog-matching.eval.test.ts",
    "tests/eval/intake-followup.eval.test.ts",
    "tests/eval/precall-brief.eval.test.ts",
  ],
  "lib/booking-prompts-shared.ts": [
    "tests/eval/blog-matching.eval.test.ts",
    "tests/eval/intake-followup.eval.test.ts",
    "tests/eval/precall-brief.eval.test.ts",
  ],
  "lib/claude-booking.ts": [
    "tests/eval/blog-matching.eval.test.ts",
    "tests/eval/intake-followup.eval.test.ts",
    "tests/eval/precall-brief.eval.test.ts",
  ],
  "lib/diagnostic/recommend.ts": ["tests/eval/recommend.eval.test.ts"],
  "lib/diagnostic/prompts.ts": ["No dedicated eval; manually verify report output"],
  "lib/diagnostic/prompt-config.ts": [
    "No dedicated eval; manually verify report output",
  ],
  "lib/diagnostic/prompt-config-shared.ts": [
    "No dedicated eval; manually verify report output",
  ],
  "lib/integration-config.ts": ["all 5 suites"],
  "lib/integration-config-shared.ts": ["all 5 suites"],
};

function listChangedFiles() {
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" });
  } catch {
    // Offline or no remote — fall through and use local main as the base.
  }
  // Files changed on this branch vs origin/main. --name-only gives
  // one path per line. Filter out deletions and renames-source — we
  // only care about the current state of files in the branch.
  let output;
  try {
    output = execSync("git diff --name-only --diff-filter=ACMR origin/main...HEAD", {
      encoding: "utf8",
    });
  } catch {
    // No origin/main reference (first push of a fresh repo, etc.).
    // Fall back to comparing against the merge-base with local main.
    try {
      output = execSync("git diff --name-only --diff-filter=ACMR main...HEAD", {
        encoding: "utf8",
      });
    } catch {
      return [];
    }
  }
  return output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const changed = listChangedFiles();
if (changed.length === 0) {
  process.exit(0);
}

const matches = [];
for (const file of changed) {
  for (const { path, reason } of SENSITIVE_PATHS) {
    if (file === path) {
      matches.push({ file, reason });
    }
  }
}

if (matches.length === 0) {
  process.exit(0);
}

// Build the suite-hint set (dedupe across all matched files).
const suites = new Set();
for (const m of matches) {
  const hint = SUITE_HINTS[m.file];
  if (hint) hint.forEach((s) => suites.add(s));
}

const prefix = mode === "ci" ? "::warning::" : "";
const reminderHeader =
  mode === "ci"
    ? "Eval reminder: this PR touches LLM-adjacent code"
    : "[eval-needed] This branch touches LLM-adjacent code";

console.error("");
console.error(`${prefix}${reminderHeader}`);
console.error("");
for (const m of matches) {
  console.error(`  ${m.file}  (${m.reason})`);
}
console.error("");
console.error("Run `pnpm eval` locally before merging to catch:");
console.error("  - Prompt drift from admin edits or starter changes");
console.error("  - Embedding-model or Claude-model swaps");
console.error("  - Retrieval quality regressions");
console.error("  - Editorial drift in posts (recommend.eval only)");
console.error("");
console.error("Suites that cover the touched files:");
for (const s of suites) {
  console.error(`  - ${s}`);
}
console.error("");
console.error(
  "Eval secrets live in the integration-config DB, not in CI — running here would require duplicating them. This is a reminder only.",
);
console.error("");

// Always exit 0 — eval is a developer-side gate, not a CI blocker.
process.exit(0);
