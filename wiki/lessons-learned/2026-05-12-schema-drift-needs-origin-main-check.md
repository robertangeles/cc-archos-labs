---
title: Schema drift claims need an origin/main check, not just the working tree
category: lessons-learned
created: 2026-05-12
updated: 2026-05-12
related: [[2026-05-08-drizzle-kit-push-hangs-on-render]]
---

## Problem

During Book-a-Call Lane A work, ran a "schema drift" audit on the
`magic_link_token` table that existed in Render Postgres but appeared
unused. The audit reported:

- `grep -r magic_link_token` on the feature branch working tree → 0 hits
- Not present in the feature branch's `lib/db/schema.ts`
- Wiki said W4 Pass 2 (the feature that owned the table) was deferred
- `git log -S "magic_link_token"` on the feature branch → empty

Conclusion declared: orphaned. Wrote a cleanup migration to drop it.
Applied to Render. Dropped the table + its 3 rows.

**Reality:** PR #4 ("W4 Pass 2: magic-link sign-in for return visitors")
had been merged to `main` and deployed to Render ~14 hours before the
audit ran. The feature branch was based on a commit prior to that merge,
so `grep` against the branch tree returned 0 hits — but the same grep
against `origin/main` would have shown the W4 Pass 2 code referencing
the table. Production was running code that expected the table to exist;
the drop broke the W4 Pass 2 sign-in flow until manual restore.

## Fix

Before claiming any schema or code is unreferenced, fetch the latest
state and check `origin/main` (and any other long-lived branches), not
just the feature branch's working tree:

```bash
git fetch origin
git log origin/main..HEAD --oneline           # what's only on your branch
git log HEAD..origin/main --oneline           # what's only on main (and you don't have)

# For grep audits: search across all branches, not just the working tree
git grep "<symbol>" origin/main -- "*.ts" "*.sql"
git log --all -S "<symbol>" -- "*.ts" "*.sql"
```

For DB schema drift specifically, also check `drizzle/` against `origin/main`
— a migration filename you don't have locally is a strong signal someone
else's PR added the table:

```bash
git ls-tree origin/main drizzle/ | grep -v "$(git ls-tree HEAD drizzle/ | awk '{print $NF}')"
```

## Rule

A "this code is unreferenced" or "this table is orphaned" claim requires
a fresh `git fetch` and an explicit check of `origin/main` — not just the
feature branch's working tree. Even better: check the live runtime
(`__drizzle_applied` table on Render) to know what migrations have
actually been applied to the deployment, since the DB is the canonical
source of truth for "what's live right now."

Destructive operations against shared state (production DB, shared
config) need this check *before* the destructive command, not after.
This rule applies to any "drift" cleanup work — schema, feature flags,
env vars, deprecated routes.

CLAUDE.md already mandates `git pull main` before starting a new branch;
this lesson extends that: also fetch + diff before declaring drift mid-
branch, since `main` keeps moving while your branch is open.
