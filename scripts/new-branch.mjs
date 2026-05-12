// One-shot helper for creating a feature branch from the latest origin/main.
//
// Replaces the four-step ritual:
//   git fetch origin --prune
//   git checkout main
//   git pull --ff-only
//   git checkout -b feature/x
//
// with: `pnpm new-branch feature/x`. Refuses if the working tree is
// dirty (uncommitted changes would carry into the new branch). Fails
// loudly if local main has diverged from origin (someone rebased main —
// dangerous).
//
// Exists because the manual ritual is easy to skip, and skipping it
// produces stale-base branches that hit GitHub's "out-of-date with
// base branch" check at merge time. Documented in
// wiki/lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md
// as the wider class of bug.

import { execSync, spawnSync } from "node:child_process";

const branchName = process.argv[2];

if (!branchName) {
  console.error("");
  console.error("Usage: pnpm new-branch <branch-name>");
  console.error("");
  console.error("Examples:");
  console.error("  pnpm new-branch feature/foo");
  console.error("  pnpm new-branch fix/login-timeout");
  console.error("");
  process.exit(1);
}

// 1. Reject dirty working tree before we touch anything.
const status = exec("git status --porcelain");
if (status.length > 0) {
  console.error("");
  console.error(
    "[!] Working tree has uncommitted changes. Commit, stash, or discard them first:",
  );
  console.error("");
  for (const line of status.split("\n")) {
    console.error(`    ${line}`);
  }
  console.error("");
  process.exit(1);
}

// 2. Refuse to overwrite an existing branch by the same name.
const branchExists = spawnSync(
  "git",
  ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
  { stdio: "ignore" },
).status === 0;
if (branchExists) {
  console.error("");
  console.error(`[!] A local branch named "${branchName}" already exists.`);
  console.error(`    Pick a different name or delete the existing branch first:`);
  console.error(`        git branch -D ${branchName}`);
  console.error("");
  process.exit(1);
}

// 3. Fetch the latest from origin so we can branch from the real tip.
console.log(`Fetching origin…`);
try {
  execSync("git fetch origin --prune", { stdio: "inherit" });
} catch {
  console.error("");
  console.error("[!] Could not fetch from origin. Check your network and try again.");
  console.error("");
  process.exit(1);
}

// 4. Switch to main and fast-forward to origin/main. Refuses if main
//    has diverged (someone force-pushed or there are unpushed local
//    commits we don't want to mix into the new branch).
const currentBranch = exec("git rev-parse --abbrev-ref HEAD");
if (currentBranch !== "main") {
  console.log(`Switching to main…`);
  const checkoutResult = spawnSync("git", ["checkout", "main"], {
    stdio: "inherit",
  });
  if (checkoutResult.status !== 0) {
    console.error("[!] Failed to switch to main.");
    process.exit(1);
  }
}

console.log(`Updating main with --ff-only…`);
const pullResult = spawnSync("git", ["pull", "--ff-only", "origin", "main"], {
  stdio: "inherit",
});
if (pullResult.status !== 0) {
  console.error("");
  console.error(
    "[!] Local main can't be fast-forwarded to origin/main. Resolve this manually:",
  );
  console.error("    1. Check what's different: git log --oneline main..origin/main");
  console.error("    2. Reset if appropriate:    git reset --hard origin/main");
  console.error("    3. Or rebase your unpushed local commits onto origin/main.");
  console.error("");
  process.exit(1);
}

// 5. Branch from the now-current main.
const baseSha = exec("git rev-parse --short main");
console.log(`Creating branch ${branchName} from main (${baseSha})…`);
const branchResult = spawnSync(
  "git",
  ["checkout", "-b", branchName],
  { stdio: "inherit" },
);
if (branchResult.status !== 0) {
  console.error("[!] Failed to create the new branch.");
  process.exit(1);
}

console.log("");
console.log(`✓ On branch ${branchName}, based on main @ ${baseSha}`);
console.log("");

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}
