---
title: Inspect third-party installer scripts before running them
category: lessons-learned
created: 2026-05-21
updated: 2026-05-21
related: [[gstack-tooling]]
---

## Problem

Installing [gstack](https://github.com/garrytan/gstack) — a 50-skill pack for Claude Code — from a one-line install prompt looked like a 30-second job. The README's "30-second" install said:

> Install gstack: run `git clone --depth 1 ... && cd ... && ./setup` then add a "gstack" section to CLAUDE.md ...

The actual install surfaced three gotchas that the one-liner did not warn about:

1. **Hidden prerequisite — Bun.** The setup script exits 1 with no install when `bun` is not on PATH. The repo README lists Bun under "Requirements" but the install prompt itself does not. Running blind would have triggered a runtime error after the clone, leaving a half-installed state.
2. **`.claude/` is gitignored at the directory level** (line 37, comment: "per-session artifacts; never repo content"). gstack's `--team` mode wants to commit `.claude/hooks/check-gstack.sh` and `.claude/settings.json` so teammates get the PreToolUse enforcement hook. Naïvely adding `!.claude/hooks/check-gstack.sh` does NOT work — git cannot re-include files inside a directory that was ignored with a trailing slash. The pattern must be `.claude/*` (then `!` exceptions inside).
3. **gstack-team-init emits a PowerShell-only SessionStart hook.** The auto-generated `.claude/settings.json` included a `SessionStart` hook running `pnpm wiki:lint` with PowerShell syntax (`$null`, `$LASTEXITCODE`, `shell: powershell`). Broken on Linux/macOS. Would have errored on every session start until manually patched.

## Fix

Before running any third-party installer that touches `~/.claude/`, the repo, or PATH:

1. **Read the setup script first.** `gh api repos/<owner>/<repo>/contents/setup --jq '.content' | base64 -d` shows the source without cloning. Five seconds of reading caught the Bun requirement up front.
2. **Verify prerequisites against the actual script logic** — not just the README. The README lists requirements optimistically; the script enforces them.
3. **Inspect every file the installer creates** before committing. For gstack the new files were `.claude/hooks/check-gstack.sh` and `.claude/settings.json` — both needed review:
   - The bash hook was fine (POSIX-compatible, simple deny logic).
   - The settings.json had the PowerShell hook bug — caught by reading the file.
4. **For gitignore exceptions, never use `!.dir/file` if `dir/` (trailing slash) is already ignored.** Convert the parent rule to `dir/*` first. Test with `git status --untracked-files=all --short` to confirm the file becomes visible to git.

For this install specifically, the resolved state in commit `de026e0` (`chore/install-gstack`) is:
- gstack at `~/.claude/skills/gstack` (user-level, all projects)
- `~/.claude/CLAUDE.md` has the user-level gstack section + `/browse` rule
- `.claude/settings.json` has only the PreToolUse Skill enforcement hook (PowerShell SessionStart removed)
- `.gitignore` pattern changed from `.claude/` to `.claude/*` + targeted `!` exceptions

## Rule

**Read every third-party installer script before executing it.** "Curl pipe bash" is bad; "blind clone + ./setup" is the same risk class. The five-second cost of `gh api ... contents/setup | base64 -d` is always lower than the cost of an unexpected runtime, unexpected files, or platform-specific failures discovered mid-install.

**Specific sub-rules from this install:**

- For any `--team` mode in a tool that writes to `.claude/` (or any normally-ignored directory), check the project's `.gitignore` before committing. If the directory is ignored with a trailing slash, the installer's `git add` will silently no-op the per-file paths.
- For any auto-generated `settings.json` / config file from a third-party tool, open it and read it before committing. Auto-generation does not mean platform-aware.
- When the user says "install this third-party tool," ask scope explicitly: user-level only, or commit to the repo? Commit-to-repo always crosses a higher-blast-radius line and deserves its own confirmation.

Related: gstack itself is documented at [[gstack-tooling]] (skill catalog + when to use which command).
