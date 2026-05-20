# wiki/synthesis/ — cross-cutting analysis (Karpathy Layer 2, synthesis class)

Per [Karpathy's wiki pattern](../concepts/karpathy-llm-wiki-pattern.md), synthesis pages capture **reusable cross-cutting analysis** that doesn't belong to a single entity or concept. They're what compound the wiki beyond just ingested sources — a question Rob asked that produced an answer worth keeping, a comparison across multiple decision docs, an open question that recurs.

## When to add a synthesis page

- A Query produced an answer the next session might also ask (comparison, framework, recurring trade-off).
- Two or more entity/concept pages contain partial views of the same thing and a unifying page is worth more than scattering the analysis.
- An open question recurs across sessions and deserves a parking spot.

## When NOT to add a synthesis page

- The analysis fits cleanly inside an existing entity or concept — extend that page instead.
- The synthesis is for one decision in one PR — write a decision doc, not a synthesis page.
- You're writing it because the lint warned about the folder being empty. Don't. The empty warning is a signal that synthesis hasn't emerged yet — that's fine.

## Examples (illustrative, not yet shipped)

- `single-db-vs-multi-env-tradeoff.md` — when single-env is the right call, when staging becomes worth it (would consolidate the deployment-architecture entity + the single-db lesson-learned + the phase-c decision doc).
- `aieo-strategy-summary.md` — what we've learned about LLM-readability across the Translation Layer launch + blog rendering + meta strategy.
- `practitioner-positioning-recurring-questions.md` — how Archos Labs' "practitioner not Big Four" positioning has held up across home, about, consulting, and translation-layer surfaces.

These are markers, not commitments — write a synthesis page only when the synthesis is real.
