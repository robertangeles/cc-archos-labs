---
title: Karpathy LLM wiki pattern
category: concept
created: 2026-05-20
updated: 2026-05-20
related: [[karpathy-llm-wiki-pattern]], [[2026-05-20-wiki-karpathy-ops]]
---

A three-layer pattern for LLM-maintained personal knowledge bases: immutable raw sources + an LLM-owned wiki + a schema document. Three operations — Ingest, Query, Lint — drive everything. The wiki is the compounding artifact; the LLM does the bookkeeping that humans abandon. Archos Labs' wiki has run on the pattern's *shape* since day one; this concept page exists because in 2026-05-20 we finally added the *ops*.

## The core claim

> Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation.

Karpathy's alternative: the LLM doesn't just retrieve from raw documents — it **incrementally builds and maintains a structured wiki** that sits between you and the raw sources. Knowledge is compiled once and kept current, not re-derived on every query.

The result is a **persistent, compounding artifact**: cross-references are already there, contradictions are already flagged, synthesis already reflects everything that's been read. The wiki gets richer every time a source is added or a question is asked.

## The three layers

| Layer | What it is | Who owns it |
|---|---|---|
| **Raw sources** | Immutable collection — articles, papers, PDFs, transcripts, data files | User curates, LLM reads only |
| **The wiki** | LLM-generated markdown — summaries, entity pages, concept pages, comparisons, syntheses | LLM owns entirely; user reads |
| **The schema** | A `CLAUDE.md` / `AGENTS.md` defining structure + conventions + workflows | Co-evolved by user and LLM |

The schema is the configuration that turns the LLM from a generic chatbot into a disciplined wiki maintainer. It's where you encode "what counts as an entity vs a concept", "what a page must include in its frontmatter", "what happens during an ingest". Without the schema, the LLM has no consistent contract with itself across sessions.

## The three operations

**Ingest** — drop a new source, the LLM reads it, discusses takeaways, writes a summary, updates relevant entity + concept pages, appends a log entry. A single source touches ~10–15 wiki pages. Can be batch or one-at-a-time-with-human-in-loop.

**Query** — ask questions against the wiki, not raw sources. The LLM reads the index, drills into relevant pages, synthesises an answer with citations. **Good answers can be filed back as new wiki pages** — comparisons, analyses, discovered connections. This is the compounding mechanism for the user's own thinking, not just the user's sources.

**Lint** — periodically health-check the wiki. Look for contradictions, stale claims, orphan pages, missing cross-references, important entities mentioned but lacking their own page, data gaps. Suggests new questions to investigate.

## Two pillar files

- **`index.md`** — content-oriented catalog. Every page listed with a one-line summary and metadata, organised by category. The LLM reads this *first* on every query. Works at moderate scale (hundreds of pages) without needing embedding-based RAG.
- **`log.md`** — append-only chronological. Ingests, queries, lint passes. Use a consistent prefix on each entry (`## [YYYY-MM-DD] ingest | <title>`) so the log is grep-parseable.

## Why this works

> The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. Updating cross-references, keeping summaries current, noting when new data contradicts old claims, maintaining consistency across dozens of pages. Humans abandon wikis because the maintenance burden grows faster than the value.

LLMs don't get bored. They don't forget to update a cross-reference. They can touch 15 files in one pass. The wiki stays maintained because **the cost of maintenance is near zero** — and that changes what's worth building in the first place.

The deeper lineage: Vannevar Bush's 1945 Memex — private, actively curated knowledge stores with associative trails between documents. Bush couldn't solve who does the maintenance. The LLM does.

## How Archos Labs instantiates this

We've matched the *shape* since the wiki was created in 2026-05-07:

- Three-layer split: codebase as raw source / `wiki/` as LLM-owned / `CLAUDE.md` as schema
- `wiki/index.md` (content catalog) + `wiki/log.md` (append-only chronological)
- Entity + concept pages with frontmatter (`title`, `category`, `created`, `updated`, `related`)
- `[[slug]]` cross-references threaded through the body and `related:` field

We added the *ops* in [[2026-05-20-wiki-karpathy-ops]]:

- **Ingest**: `pnpm wiki:ingest --url <url> [--in-repo|--external]` scaffolds a Layer 1 source into `wiki/raw/` or `wiki/raw-index/`, then surfaces overlapping pages for the LLM to update. The synthesis step (concept pages, index, log) is the LLM's job — same contract as Karpathy.
- **Lint**: `pnpm wiki:lint` checks broken refs, orphans, frontmatter validation, index drift, stale pages, empty categories. Surfaces real drift; the LLM acts on it.
- **Query**: documented in CLAUDE.md but tooled implicitly via `pnpm wiki:search` and `pnpm wiki:graph neighbors`. When synthesis is reusable, the rule is to file it back to `wiki/synthesis/`.

## Where we extend beyond Karpathy

Karpathy's gist is intentionally abstract. Our schema adds:

- **`wiki/decisions/`** — dated ADRs with rationale and supersession chains. Not in the original; valuable when the wiki is paired with active code.
- **`wiki/lessons-learned/`** — Problem / Fix / Rule entries. Post-mortems that survive across sessions so the same mistake doesn't recur.
- **`wiki/runbooks/`** — ops procedures (rotate master key, reset admin password). Operational rather than knowledge.
- **`wiki/state.md`** — auto-generated ship register. Bridges *code → wiki* (route/endpoint/component table regenerated from `git ls-files` via [scripts/wiki-state.mjs](../../scripts/wiki-state.mjs)).
- **`wiki/backlog/`** — prioritised intent. Karpathy's wiki is about absorbed knowledge; ours doubles as project memory because the wiki is the artifact that survives between sessions.

## What this concept page is for

When future sessions ask "why does the wiki look like this?" — start here. When you're about to add a new top-level wiki folder or a new operation, read this first to check whether you're extending the pattern or breaking it. The raw gist is preserved verbatim at [[karpathy-llm-wiki-gist]].
