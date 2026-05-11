// Pre-flight check: warn if your work is behind origin/main.
//
// Two modes, picked via argv:
//   --dev      Compares local `main` with origin/main. Used at `pnpm dev`
//              startup as a gentle nudge to pull before starting work.
//   --prepush  Compares HEAD with origin/main. Used as a Husky pre-push
//              hook to warn if the feature branch is behind. Branch
//              protection on origin/main is the real gate; this just
//              surfaces the staleness earlier so the dev can rebase
//              instead of hitting a blocked PR.
//
// Both modes exit 0 — they warn, they don't block. Offline / no-remote
// runs are silently skipped so dev startup never breaks on a flight.

import { execSync } from "node:child_process";

const mode = process.argv[2] === "--prepush" ? "prepush" : "dev";

// Skip in CI runners — the workflow already runs against the right ref.
if (process.env.CI) {
  process.exit(0);
}

try {
  execSync("git fetch origin main --quiet", { stdio: "ignore" });
} catch {
  // No network, no remote, no main branch — silently skip.
  process.exit(0);
}

if (mode === "dev") {
  warnIfMainBehind();
} else {
  warnIfBranchBehindMain();
}

function warnIfMainBehind() {
  const local = revParse("main");
  const remote = revParse("origin/main");
  if (!local || !remote || local === remote) return;

  const behind = countAhead(local, remote);
  if (behind === 0) return;

  console.error("");
  console.error(`[!] Local main is ${behind} commit(s) behind origin/main.`);
  console.error("    Sync before starting new work:");
  console.error("      git checkout main && git pull");
  console.error("");
}

function warnIfBranchBehindMain() {
  const branch = currentBranch();
  // Pushing main directly is a separate concern (branch protection
  // handles it). The pre-push warning is for feature branches.
  if (!branch || branch === "main") return;

  const remoteMain = revParse("origin/main");
  if (!remoteMain) return;

  // If origin/main is an ancestor of HEAD, the branch already contains
  // every commit on main — nothing to warn about.
  const headSha = revParse("HEAD");
  if (!headSha) return;

  const mergeBase = mergeBaseOf("HEAD", remoteMain);
  if (mergeBase === remoteMain) return;

  const behind = countAhead(mergeBase, remoteMain);
  if (behind === 0) return;

  console.error("");
  console.error(
    `[!] Your branch (${branch}) is ${behind} commit(s) behind origin/main.`,
  );
  console.error("    Rebase before pushing so CI runs against the merge result:");
  console.error("      git fetch origin");
  console.error("      git rebase origin/main");
  console.error("      git push --force-with-lease");
  console.error("");
  console.error(
    "    (Pushing anyway is fine — branch protection blocks the PR merge.)",
  );
  console.error("");
}

function revParse(ref) {
  try {
    return execSync(`git rev-parse ${ref}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function mergeBaseOf(a, b) {
  try {
    return execSync(`git merge-base ${a} ${b}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function countAhead(base, tip) {
  try {
    return Number(
      execSync(`git rev-list --count ${base}..${tip}`, {
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    return 0;
  }
}

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}
