---
title: gstack — Claude Code skill pack
category: entity
created: 2026-05-21
updated: 2026-05-21
related: [[2026-05-21-third-party-installer-inspection]], [[index]]
---

[gstack](https://github.com/garrytan/gstack) is Garry Tan's open-source Claude Code skill pack — 50+ slash commands that wrap Claude Code into specialist roles (CEO, eng manager, designer, QA, security officer, release engineer). Installed in this repo on 2026-05-21 as a required tool for AI-assisted work.

## Install state (this machine)

- **User-level (all projects):** `~/.claude/skills/gstack` (cloned), `~/.claude/CLAUDE.md` has the gstack section + `/browse` rule
- **Project-level (this repo, team-mode):** [.claude/settings.json](.claude/settings.json) registers a `PreToolUse` hook on the `Skill` matcher that runs [.claude/hooks/check-gstack.sh](.claude/hooks/check-gstack.sh). The hook denies skill use and prints an install message if `~/.claude/skills/gstack/bin` is missing.
- **.gitignore:** kept `.claude/*` ignored; whitelisted only the two team-mode files. Per-developer `.claude/settings.local.json` stays ignored.
- **Prerequisite:** Bun 1.3+ (installed to `~/.bun/bin/bun`, PATH wired in `~/.bashrc`).

## When to use which command

`/office-hours` — describe a feature, get a structured back-and-forth.
`/autoplan` — generate a plan without implementing.
`/plan-ceo-review` / `/plan-eng-review` / `/plan-design-review` / `/plan-devex-review` — multi-lens plan review before building.
`/review` — code review on the current branch.
`/cso` — security audit (OWASP + STRIDE).
`/qa` — open a real browser, walk a flow, report regressions.
`/ship` / `/land-and-deploy` — release engineering.
`/browse` — web browsing (REQUIRED for any web fetch; do NOT use `mcp__claude-in-chrome__*`).
`/investigate` — bug investigation.
`/retro` — post-session retrospective.

Full skill list lives in [CLAUDE.md](../../CLAUDE.md) under the "gstack (REQUIRED — global install)" section.

## Why team mode

Without the `PreToolUse` hook, teammates would silently work without gstack and the patterns we're building on top of it would diverge. The hook blocks the `Skill` tool entirely when gstack isn't installed globally — fast feedback at the start of a session instead of subtle drift across PRs.

## Caveats

See [[2026-05-21-third-party-installer-inspection]] for the three gotchas surfaced during install:
- Hidden Bun prerequisite
- Gitignore + nested negation pattern
- PowerShell-only SessionStart hook in the auto-generated settings.json
