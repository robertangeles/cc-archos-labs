---
title: Wiki Karpathy ops — ingest + lint + foundation tooling
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[karpathy-llm-wiki-pattern]]
---

Made the wiki actually run on Karpathy's three-layer pattern: built the missing foundation scripts (search + graph) that CLAUDE.md already documented, and added the two core ops it didn't (ingest + lint). The wiki was previously a write-only journal — now it can absorb sources and self-audit.

## Gap analysis (what triggered this)

Rob asked whether the wiki implementation matches [the Karpathy gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Audit found:

**Shape was aligned:**
- Three-layer split (codebase as raw, `wiki/` as LLM-owned, `CLAUDE.md` as schema)
- `index.md` (content-oriented catalog) + `log.md` (append-only chronological)
- Entity + concept pages with frontmatter + `[[slug]]` cross-refs

**Ops were missing:**
- No **Ingest** workflow — wiki was written forward from work-in-progress, never backward from external sources. `raw/` was explicitly "conceptual — there is no literal folder."
- No **Lint** workflow — no periodic health check for broken refs, orphans, stale pages, or index drift.
- No **Query** workflow — synthesised answers were ephemeral, never filed back as `wiki/synthesis/` pages.

**Tooling debt discovered mid-audit:**
- CLAUDE.md documented `scripts/wiki-search.mjs` and `scripts/wiki-graph.mjs` as if they existed. Only `wiki-state.mjs` was real. The aspirational tooling never shipped.

## What changed

### Foundation scripts (made CLAUDE.md's tooling section honest)

- **[`scripts/wiki-search.mjs`](../../scripts/wiki-search.mjs)** — line-oriented grep across `wiki/**/*.md`. Default lists matching paths; `-c <query>` adds 2 lines of context per match. Pure stdlib, no deps.
- **[`scripts/wiki-graph.mjs`](../../scripts/wiki-graph.mjs)** — parses frontmatter `related:` + body `[[slug]]` refs into nodes + edges. Subcommands: `build / stats / neighbors / orphans / category / broken`. Writes `wiki/.graph.json` (gitignored, regenerable).

### Karpathy ops

- **[`scripts/wiki-ingest.mjs`](../../scripts/wiki-ingest.mjs)** — scaffolds an ingest from `--url`, `--file`, or `--paste`. URLs convert via turndown (already a dep). Placement is `--in-repo` (full text into `wiki/raw/<slug>.md`) or `--external` (pointer into `wiki/raw-index/<slug>.md`, default). After placement: prints overlapping pages (via search) + a checklist for the LLM. Synthesis is the LLM's job, per Karpathy — script just scaffolds.
- **[`scripts/wiki-lint.mjs`](../../scripts/wiki-lint.mjs)** — periodic health check. Auto-runs `wiki:graph build` first, then checks: broken refs, orphans, frontmatter validation, index drift (disk ↔ `wiki/index.md`), stale-page heuristic (page > 90d old + linked from page < 30d old), empty category folders, future-dated frontmatter. Hard errors → exit 1; warnings → exit 0.

### Folder layout

- New `wiki/raw/` for Layer 1 sources checked into the repo (small, public, worth preserving). [README](../raw/README.md) documents the `raw/` vs `raw-index/` placement rule.
- `wiki/.graph.json` added to `.gitignore` — regenerable artefact, not source.

### CLAUDE.md

Three new sections under "LLM Wiki" — **Ingest workflow** (9 steps), **Lint workflow** (when + how to act on the report), **Query workflow** (cite pages used; file reusable synthesis to `wiki/synthesis/`). The existing "Wiki tooling" section was updated to use `pnpm wiki:*` aliases for consistency with the rest of the repo, and to acknowledge ingest + lint exist.

### Package scripts

```
pnpm wiki:search <query>
pnpm wiki:graph <build|stats|neighbors|orphans|category|broken> [arg]
pnpm wiki:ingest <--url|--file|--paste> [--in-repo|--external] [--slug <slug>]
pnpm wiki:lint
```

`pnpm wiki:state` is unchanged.

## What this is NOT

- Not a Husky hook for lint. Manual + pre-PR for now. We can wire to pre-commit later if drift bites; right now adding another pre-commit step costs more than it saves.
- Not auto-ingest. Every ingest is user-initiated — "ingest this" is the explicit trigger.
- Not a change to the AI Readiness assessment, the diagnostic engine, the booking flow, or any application code. Pure tooling.
- Not a rewrite of existing wiki pages. The existing wiki content stays as-is. The new ops simply give us a way to grow it from sources, and to audit it for drift.

## Why this matters now

The wiki has 60+ pages across entities, concepts, decisions, lessons-learned, runbooks, and backlog. It's already past the threshold where lint catches things faster than human review. And the next phase of work (Translation Layer Phase D, executive content for the consulting page, any future AI / consulting industry research) involves reading external sources Rob will want to absorb into the wiki — which is exactly what ingest exists for.

## Verification

Per Karpathy's pattern, the proof is end-to-end. The same PR ingests the Karpathy gist itself as the wiki's first real Layer 1 source — that's the live test that ingest → graph → lint roundtrip works. See the session log entry for the resulting raw page + concept page.
