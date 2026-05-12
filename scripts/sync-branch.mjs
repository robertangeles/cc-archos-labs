// pnpm sync-branch — bring the current feature branch up to date with
// origin/main. Run this when Dev2 (or you) merged something to main
// while your branch was open.
//
// Replaces the manual ritual:
//   git fetch origin
//   git rebase origin/main
//   git push --force-with-lease     # only if branch is on remote
//
// Refuses if:
//   - working tree is dirty
//   - currently on main (this script is for feature branches)
//   - rebase produces conflicts (leaves them in place for manual resolution)
//
// Exit codes:
//   0  branch is now up to date (rebased + pushed if needed, or already current)
//   1  refused to run (dirty tree, on main, missing remote) or rebase conflict
//
// Pairs with pnpm new-branch (creates feature branches from latest main)
// and pnpm wip (lists open PRs + branches + recent main commits).

import { execSync, spawnSync } from "node:child_process";

// 1. Dirty working tree guard.
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

// 2. Don't run on main.
const branch = exec("git rev-parse --abbrev-ref HEAD");
if (branch === "main" || branch === "HEAD") {
  console.error("");
  console.error(
    `[!] Currently on ${branch === "HEAD" ? "a detached HEAD" : "main"}.`,
  );
  console.error(
    "    pnpm sync-branch is for feature branches. On main, just run:",
  );
  console.error("        git pull");
  console.error("");
  process.exit(1);
}

// 3. Fetch latest from origin.
console.log("Fetching origin…");
try {
  execSync("git fetch origin --prune", { stdio: "inherit" });
} catch {
  console.error("");
  console.error("[!] Could not fetch from origin. Check your network and try again.");
  console.error("");
  process.exit(1);
}

// 4. Skip the rebase if the branch already contains every commit on
//    origin/main. Cheaper + clearer messaging.
const mergeBase = exec(`git merge-base HEAD origin/main`);
const remoteMain = exec(`git rev-parse origin/main`);
if (mergeBase === remoteMain) {
  console.log("");
  console.log(`✓ Branch ${branch} already contains all of origin/main. Nothing to do.`);
  console.log("");
  process.exit(0);
}

// 5. Rebase onto origin/main. Spawn directly so the user sees git's
//    progress + any conflict messages in real time.
console.log(`Rebasing ${branch} onto origin/main…`);
const rebaseResult = spawnSync("git", ["rebase", "origin/main"], {
  stdio: "inherit",
});
if (rebaseResult.status !== 0) {
  console.error("");
  console.error(
    "[!] Rebase has conflicts (or another failure). Resolve them and run:",
  );
  console.error("        git rebase --continue       # after staging the fix");
  console.error("        git rebase --abort          # to bail out");
  console.error("");
  console.error(
    "    Once the rebase completes, run pnpm sync-branch again to push.",
  );
  console.error("");
  process.exit(1);
}

// 6. Push if the branch is tracking a remote. Otherwise leave the
//    update local — the user pushes when they're ready.
const hasUpstream =
  spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { stdio: "ignore" },
  ).status === 0;

if (!hasUpstream) {
  console.log("");
  console.log(
    `✓ ${branch} rebased onto origin/main. No upstream — push when you're ready:`,
  );
  console.log(`        git push -u origin ${branch}`);
  console.log("");
  process.exit(0);
}

console.log(`Pushing ${branch} (force-with-lease)…`);
const pushResult = spawnSync(
  "git",
  ["push", "--force-with-lease"],
  { stdio: "inherit" },
);
if (pushResult.status !== 0) {
  console.error("");
  console.error(
    "[!] Push failed. If someone else pushed to your branch since you last",
  );
  console.error(
    "    fetched, fetch + resolve the divergence by hand before retrying.",
  );
  console.error("");
  process.exit(1);
}

console.log("");
console.log(`✓ ${branch} synced with origin/main and pushed.`);
console.log("");

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}
