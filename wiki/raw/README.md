# wiki/raw/ — source material checked into the repo

Karpathy's wiki pattern has three layers: **raw sources** (immutable),
**wiki pages** (LLM-owned summaries + entities + concepts), and the
**schema** (CLAUDE.md). This folder is Layer 1.

## When to put a source here vs `wiki/raw-index/`

**Use `wiki/raw/` when:**
- Source is small (under ~50KB of markdown)
- Source is public (no client material, no NDA-bound content)
- We want it to travel with the repo so the LLM can re-read offline
- Source is worth preserving verbatim (e.g. an influential gist, a foundational article)

**Use `wiki/raw-index/` (pointer page) when:**
- Source lives in Drive / Notion / a private system
- Source is large (PDFs, transcripts, datasets)
- Source is client-private or NDA-bound
- Source is a snapshot of state that's queryable elsewhere (e.g. WP inventory)

When in doubt, pointer first — the LLM can always re-run `pnpm wiki:ingest --in-repo` later.

## How sources land here

```
pnpm wiki:ingest --url <url> --in-repo
pnpm wiki:ingest --file <path> --in-repo
pnpm wiki:ingest --paste --in-repo --slug <slug>   (reads stdin)
```

The script writes a frontmatter block + the source text verbatim. **Do not
hand-edit the source content** — if the upstream changes, re-ingest with a
new `--slug` and supersede the old page.

## Don't put summaries here

Summaries belong in `wiki/concepts/` or `wiki/entities/`. Raw pages stay raw.
The LLM reads a raw page, then writes a concept/entity page that synthesises
what matters into the wiki proper. That separation is the whole point of the
three-layer pattern.
