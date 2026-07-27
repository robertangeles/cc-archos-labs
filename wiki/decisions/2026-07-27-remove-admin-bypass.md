---
title: Remove admin bypass from the main branch ruleset
category: decision
created: 2026-07-27
updated: 2026-07-27
related: [[deployment-architecture]], [[2026-07-27-dev-db-is-per-machine]], [[index]]
---

Admin-role bypass was removed from the `Main Protection` ruleset, so branch protection now applies to everyone including the repo owner.

## Context

A wiki-only commit was pushed straight to `main` on 2026-07-27. It succeeded, and GitHub reported why:

```
remote: Bypassed rule violations for refs/heads/main:
remote: - Changes must be made through a pull request.
remote: - Required status check "lint + typecheck + build" is expected.
```

**The rules were never the problem.** `Main Protection` was `active` and correctly configured — `pull_request`, `required_status_checks`, `required_linear_history`, `non_fast_forward`, `deletion`. It carried one bypass actor:

```
actor_type=RepositoryRole  actor_id=5  mode=always
```

`RepositoryRole 5` is Repository admin, and `mode=always` bypasses every rule on every operation, including a direct push. There was no classic branch protection underneath (the API returns 404), so this ruleset was the only gate — and it did not apply to the one account doing most of the work.

`CLAUDE.md` had said "CI must pass before merging — never bypass" since 2026-05-11. The instruction was in place for two and a half months while the mechanism enforcing it was disabled for the only user who could violate it. **A written rule and an enforced rule are different things, and the gap between them is invisible until something exercises it.**

## Decision

Set `bypass_actors` to `[]`. Rules unchanged.

Rejected the softer option of downgrading `mode` from `always` to `pull_request`, which would have blocked direct pushes while still permitting an admin to merge a PR with red CI. It closes the observed hole and leaves the more consequential one open — shipping code that fails `lint + typecheck + build` is worse than shipping a wiki edit that skipped a PR.

## Consequences

- **Every change goes through a PR**, including one-line wiki and backlog edits. `required_approving_review_count` is `0`, so green CI is the gate and self-merge is fine for routine work.
- **`--no-ff` merges are dead** — `required_linear_history` rejects merge commits. Squash-merge only. `CLAUDE.md` had instructed `--no-ff`, which the ruleset would have rejected anyway; corrected in the same change.
- **The backlog-claim convention got slower.** It previously relied on pushing a one-line claim directly to `main`. It is now a small PR. If that friction bites, move claims to GitHub issues or let an early-pushed branch signal the claim — do not restore the bypass.
- **`/ship` and `/land-and-deploy` may have merge steps that assumed bypass.** Not yet exercised under the new ruleset. Worth a dry run before relying on either under time pressure.
- **Emergency path:** Settings → Rules → Main Protection, re-enable bypass or set enforcement to `disabled`, land the fix, turn it back off, record it in `wiki/log.md`. The owner cannot be locked out. Making the escape hatch a deliberate, visible, reversible act is the entire point — the failure mode was a door standing open that nobody could see.

## Verification

Asserting the API accepted the change is not evidence it enforces. Verified by attempting a real direct push of an empty commit and confirming rejection:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
 ! [remote rejected] main -> main (push declined due to repository rule violations)
```

Note the wording shift from **"Bypassed rule violations"** to **"Repository rule violations found"** — that difference is the whole change. Test commit was discarded with `git reset --hard origin/main`.

Original ruleset JSON backed up before the edit, in case the exact prior configuration is ever needed.

## Rule

**When a policy exists in writing, verify the mechanism that enforces it.** Configuration that looks correct in a settings page can carry an exemption that makes it decorative. Read the bypass list, not just the rule list.

**Test a guard by trying to violate it.** A successful API write proves the write, not the enforcement.
