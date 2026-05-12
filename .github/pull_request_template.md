## Summary

<!-- One paragraph: what changed and why. Link to backlog / wiki page if relevant. -->

## Test plan

<!-- Bulleted checklist of what you verified. Replace these with the real checks. -->

- [ ] `pnpm lint`, `pnpm tsc`, `pnpm test`, `pnpm build` all clean locally
- [ ] Manual smoke test of the changed flow
- [ ] Any new API route exercised end-to-end (curl or browser)
- [ ] If UI: tested at mobile width (390px) + desktop

## Screenshots / output

<!-- For UI changes, before/after. For backend, paste the curl + response. -->

## Destructive operations?

<!--
Tick if this PR includes any of:
  - DROP TABLE / DROP COLUMN / DROP INDEX / DROP CONSTRAINT
  - TRUNCATE / DELETE FROM without WHERE
  - ALTER TABLE ... DROP
  - File deletions of code the OTHER dev wrote
  - Removal of an API route, env var, or feature flag in active use

If any: the migration-safety CI check will block the merge until you either
add the `migration-destructive` label OR add `-- safety: verified against
origin/main on YYYY-MM-DD by <name>` as the first line of the .sql file.
See CONTRIBUTING.md → "Bypass conventions" for the cross-review requirement.
-->

- [ ] No destructive operations
- [ ] Destructive — verified against `origin/main`; the OTHER dev has reviewed in this PR thread

## Notes for the reviewer

<!-- Anything non-obvious: trade-offs, alternatives considered, follow-ups -->
