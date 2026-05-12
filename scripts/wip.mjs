// Morning routine — one command, full picture of what's in flight.
//
//   pnpm wip
//
// Reports:
//   - Open PRs (number, head branch, author, CI status, age, behind-main-by)
//   - Open feature branches on origin that don't have an open PR (orphans)
//   - Last 5 merges to main
//
// Requires the `gh` CLI to be authenticated (`gh auth status`). If gh
// isn't available, prints a graceful warning and falls back to the
// git-only sections.
//
// Designed for two-developer flow: glance every morning to see what
// the other dev is doing before you pick anything up.

import { execSync, spawnSync } from "node:child_process";

// Make sure we're working with an up-to-date snapshot.
try {
  execSync("git fetch origin --prune", { stdio: "ignore" });
} catch {
  // Offline or no remote — continue with whatever we have locally.
}

const hasGh = spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;

console.log("");
printOpenPRs();
console.log("");
printOrphanBranches();
console.log("");
printRecentCommits();
console.log("");

// ---------------------------------------------------------------------------

function printOpenPRs() {
  if (!hasGh) {
    console.log("Open PRs — (skipped, `gh` CLI not installed or not on PATH)");
    return;
  }

  let prs;
  try {
    const raw = execSync(
      'gh pr list --state open --json number,title,headRefName,author,createdAt,statusCheckRollup,mergeStateStatus,isDraft',
      { encoding: "utf8" },
    );
    prs = JSON.parse(raw);
  } catch (err) {
    console.log("Open PRs — could not load (`gh pr list` failed):");
    console.log(`  ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
    return;
  }

  if (prs.length === 0) {
    console.log("Open PRs (0)");
    return;
  }

  console.log(`Open PRs (${prs.length})`);
  for (const pr of prs) {
    const status = ciStatus(pr);
    const age = humanAge(pr.createdAt);
    const author = pr.author?.login ?? "unknown";
    const draft = pr.isDraft ? " (draft)" : "";
    const behind = behindMain(pr.headRefName);
    const behindLabel = behind === null ? "" : behind === 0 ? "on-top-of-main" : `${behind} commit(s) behind main`;
    console.log(
      `  #${pr.number}  ${pad(pr.headRefName, 38)}  ${pad(author, 16)}  ${pad(status, 8)}  ${pad(age, 9)}  ${behindLabel}${draft}`,
    );
    console.log(`        ${pr.title}`);
  }
}

function printOrphanBranches() {
  let branches;
  try {
    const raw = spawnSync(
      "git",
      [
        "for-each-ref",
        "--format=%(refname:short)|%(committerdate:iso8601)|%(authorname)",
        "refs/remotes/origin/",
      ],
      { encoding: "utf8" },
    ).stdout ?? "";
    branches = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        const [name, when, author] = l.split("|");
        return {
          name: name.replace(/^origin\//, ""),
          when,
          author,
        };
      })
      .filter(
        (b) =>
          b.name !== "main" &&
          b.name !== "origin" &&
          !b.name.startsWith("HEAD") &&
          !b.name.includes("/HEAD"),
      );
  } catch {
    console.log("Open feature branches — could not load.");
    return;
  }

  // Cross-reference against open PR head branches when gh is available.
  let prHeadBranches = new Set();
  if (hasGh) {
    try {
      const raw = execSync(
        'gh pr list --state open --json headRefName',
        { encoding: "utf8" },
      );
      const parsed = JSON.parse(raw);
      prHeadBranches = new Set(parsed.map((p) => p.headRefName));
    } catch {
      // ignore — orphan check just becomes "all open branches"
    }
  }

  const orphans = branches.filter((b) => !prHeadBranches.has(b.name));
  if (orphans.length === 0) {
    console.log("Open feature branches without PRs (0)");
    return;
  }

  console.log(`Open feature branches without PRs (${orphans.length})`);
  for (const b of orphans) {
    const age = humanAge(b.when);
    console.log(
      `  ${pad(b.name, 40)}  ${pad(b.author, 18)}  last push ${age}`,
    );
  }
}

function printRecentCommits() {
  // Linear-history + squash-merge means each PR lands as one commit
  // on main. Listing recent commits = listing recent merged PRs.
  // Use spawnSync with array args so the shell can't interpret the
  // `%s` etc. in the format string — on Windows cmd.exe, `%s` gets
  // mangled by variable expansion.
  const raw = runGitLog([]);
  if (!raw.trim()) {
    console.log("Recent commits on main — could not load.");
    return;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  console.log(`Recent commits on main (${lines.length})`);
  for (const line of lines) {
    const [sha, subject, when] = line.split("|");
    console.log(`  ${sha}  ${pad(subject, 60)}  ${when}`);
  }
}

// ---------------------------------------------------------------------------

function ciStatus(pr) {
  const checks = pr.statusCheckRollup ?? [];
  if (checks.length === 0) return "—";
  const failed = checks.some(
    (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
  );
  if (failed) return "red";
  const pending = checks.some(
    (c) => !c.conclusion || c.status !== "COMPLETED",
  );
  if (pending) return "running";
  return "green";
}

function behindMain(branchName) {
  try {
    const head = execSync(
      `git rev-parse refs/remotes/origin/${branchName}`,
      { encoding: "utf8" },
    ).trim();
    const main = execSync(`git rev-parse refs/remotes/origin/main`, {
      encoding: "utf8",
    }).trim();
    const mergeBase = execSync(`git merge-base ${head} ${main}`, {
      encoding: "utf8",
    }).trim();
    if (mergeBase === main) return 0;
    return Number(
      execSync(`git rev-list --count ${mergeBase}..${main}`, {
        encoding: "utf8",
      }).trim(),
    );
  } catch {
    return null;
  }
}

function humanAge(iso) {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < hour) return `${Math.round(ms / minute)}m ago`;
  if (ms < day) return `${Math.round(ms / hour)}h ago`;
  return `${Math.round(ms / day)}d ago`;
}

function runGitLog(extraArgs) {
  const args = [
    "log",
    "origin/main",
    "--pretty=format:%h|%s|%ar",
    "-n",
    "5",
    ...extraArgs,
  ];
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.stdout ?? "";
}

function pad(s, n) {
  if (!s) return " ".repeat(n);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
