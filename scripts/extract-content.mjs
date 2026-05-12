// scripts/extract-content.mjs
//
// One-shot helper that produces a valid `DiagnosticContent` JSON blob
// from a historic commit of `lib/diagnostic/content.ts`. Paste the
// output into /admin/diagnostic to seed the admin row after D-27.
//
// Usage:
//   pnpm extract-content                          # default commit dcd6652, stdout
//   pnpm extract-content <commit-sha>             # any historic commit, stdout
//   pnpm extract-content <commit-sha> out.json    # write to file
//
// Implementation: creates a detached git worktree at the historic
// commit, drops a tiny TypeScript loader inside it, runs the loader
// via Node's built-in TS support (Node 22.6+), captures the JSON,
// and cleans up the worktree. No additional dependencies required —
// content.ts at the source commit only imports from "./types" which
// is also in the worktree.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const COMMIT = process.argv[2] ?? "dcd6652";
const OUT_PATH = process.argv[3];

// Validate the commit exists locally. If not, suggest a fetch. Use
// spawnSync with array args so Windows cmd.exe doesn't eat the `^{`
// in `^{commit}` (it's the escape character on cmd).
{
  const r = spawnSync("git", ["rev-parse", "--verify", `${COMMIT}^{commit}`], {
    stdio: "ignore",
  });
  if (r.status !== 0) {
    console.error("");
    console.error(`[!] Commit ${COMMIT} not found locally.`);
    console.error("    Run: git fetch origin");
    console.error("");
    process.exit(1);
  }
}

const worktreeDir = mkdtempSync(join(tmpdir(), "extract-content-"));
const extractorPath = join(worktreeDir, "_extract-historic-content.ts");

// The loader runs inside the worktree, where `./lib/diagnostic/content`
// resolves to the historic content.ts. We re-shape into the
// DiagnosticContent JSON schema and strip the optional `intent` field
// from every question (it's developer-facing-only and adds noise to
// the admin paste).
const extractorSource = [
  `import {`,
  `  DOMAIN_WEIGHTS,`,
  `  PRIORITY_TRIGGERS,`,
  `  QUESTIONS,`,
  `  RISK_FLAG_RULES,`,
  `  TIER_BOUNDARIES,`,
  `} from "./lib/diagnostic/content.ts";`,
  ``,
  `const questions = QUESTIONS.map((q) => {`,
  `  const { intent, ...rest } = q;`,
  `  return rest;`,
  `});`,
  ``,
  `const content = {`,
  `  version: "v1-source-${COMMIT}",`,
  `  questions,`,
  `  riskFlagRules: RISK_FLAG_RULES,`,
  `  priorityTriggers: PRIORITY_TRIGGERS,`,
  `  tierBoundaries: TIER_BOUNDARIES,`,
  `  domainWeights: DOMAIN_WEIGHTS,`,
  `};`,
  ``,
  `process.stdout.write(JSON.stringify(content, null, 2));`,
  ``,
].join("\n");

try {
  // 1. Detached worktree at the historic commit. --detach so we don't
  //    leave a branch behind; the worktree disappears with --force.
  const addResult = spawnSync(
    "git",
    ["worktree", "add", "--detach", worktreeDir, COMMIT],
    { stdio: "inherit" },
  );
  if (addResult.status !== 0) {
    console.error("");
    console.error(`[!] Could not create worktree at ${COMMIT}.`);
    console.error("");
    process.exit(1);
  }

  // 2. Drop the extractor TS file inside the worktree so its imports
  //    resolve to the historic ./lib/diagnostic/content + types.
  writeFileSync(extractorPath, extractorSource);

  // 3. Run with Node's built-in TypeScript support (--experimental-
  //    strip-types — sufficient because content.ts has no enums /
  //    namespaces / decorators, just type imports + annotations).
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", extractorPath],
    {
      cwd: worktreeDir,
      encoding: "utf8",
      env: {
        ...process.env,
        // Silence the experimental-feature warning on Node 22 / 24
        NODE_NO_WARNINGS: "1",
      },
    },
  );

  if (result.status !== 0) {
    console.error("");
    console.error("[!] Extractor failed:");
    console.error(result.stderr || result.stdout || "(no output)");
    console.error("");
    process.exit(1);
  }

  if (OUT_PATH) {
    writeFileSync(OUT_PATH, result.stdout);
    console.error("");
    console.error(`✓ Wrote diagnostic content JSON to ${OUT_PATH}`);
    console.error(
      `  Source: commit ${COMMIT}, lib/diagnostic/content.ts (intent fields stripped)`,
    );
    console.error("");
  } else {
    process.stdout.write(result.stdout);
  }
} finally {
  // Cleanup the worktree. --force removes it even if there are local
  // changes (we wrote the extractor into it, which counts).
  spawnSync("git", ["worktree", "remove", "--force", worktreeDir], {
    stdio: "ignore",
  });
  try {
    rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  // Some Windows setups leak a stale entry in .git/worktrees if the
  // dir-removal raced the worktree-remove. Tidy it up.
  spawnSync("git", ["worktree", "prune"], { stdio: "ignore" });
  // Touch sep to keep the import unused-warning quiet.
  void sep;
}
