---
title: Conversational memory — how to build the brain properly
category: concept
created: 2026-07-19
updated: 2026-07-19
related: [[2026-07-16-brain-inapp-pgvector-migration]], [[2026-06-10-gbrain-multi-user-integration]]
---

Research synthesis (deep-research run, 2026-07-19, 26 primary+blog sources, adversarially verified) of how production LLM memory systems build per-user memory — and what that means for the Archos in-app pgvector brain, which today naively stores every chat turn verbatim.

## The one-line answer

Every serious system does the same three things, and we do none of them: **extract** atomic facts from turns (discard the chit-chat), **consolidate** against what's already stored (dedup / update / supersede), and **retrieve** by a multi-signal score (similarity + recency + importance), not raw cosine. The distilled memory is a *thin layer on top of the transcript*, not a copy of it.

## What the field converges on (verified)

**1. Distill, don't dump.** mem0, LangMem, and AtomMem all extract atomic facts and throw away conversational noise. The transcript is kept separately for provenance (Graphiti is the one that keeps raw turns *and* derives a semantic layer — "Episodes serve as a non-lossy data store from which semantic entities and relations are extracted"). Nobody treats raw turns as "memories." This is exactly our bug: our "Your Brain" page shows `## User Hi ## Assistant What do you need help with?` as a memory.
> Sources: [Zep/Graphiti arXiv:2501.13956], [mem0 arXiv:2504.19413], [AtomMem arXiv:2606.19847], [LangMem docs]

**2. Consolidate on write.** New facts are reconciled against existing ones before storage. Two documented models:
- **Profile** (replace-in-place): a consolidated view where a new value *updates the existing record* instead of inserting a new one — good for singular attributes ("preferred framework = DMBOK").
- **Collection** (append + invalidate): store many facts, and on conflict *delete/invalidate or update* rather than duplicate.
AtomMem gates each new fact by hybrid similarity (embedding cosine + keyword Jaccard): **novel → store, conflicting → update, duplicate → discard** — three code paths, not one threshold. This is how you avoid storing "My name is Rob" five times (which we currently do).
> Sources: [LangMem docs], [AtomMem arXiv:2606.19847]

**3. Retrieve on multiple signals.** Pure vector similarity is explicitly called insufficient. LangMem: *"Recall should combine similarity with importance of the memory, as well as the memory's strength… how recently/frequently it was used."* Graphiti fuses cosine + BM25 + graph traversal. Our current recall (`0.7·sim + 0.2·recency`) is already on the right track — it just retrieves from a polluted store.
> Sources: [LangMem docs], [Zep/Graphiti arXiv:2501.13956]

**4. Conflict = supersede, don't delete.** Graphiti never deletes; it sets a `t_invalid` timestamp so newer info wins while history is preserved. Maps cleanly to a pgvector `is_active` + `superseded_at` column pattern — no graph DB required.
> Source: [Zep/Graphiti arXiv:2501.13956]

**5. Extraction is usually a background job.** LangMem names the tradeoff directly: *conscious* (synchronous, adds latency) vs *subconscious* (background, post-interaction, no latency hit). mem0 runs an async summary worker on a global-summary + last-10-messages window. AtomMem extracts facts in real-time but batches profile updates at session end.
> Sources: [LangMem docs], [mem0 arXiv:2504.19413], [AtomMem arXiv:2606.19847]

**6. The layer is small.** mem0 (ECAI 2025, peer-reviewed): ~6,956 extracted tokens/conversation vs ~26,000 full-context — **91.6% p95 latency reduction, 90%+ token savings** on LOCOMO. Distilled facts are KB-scale per user; the transcript already lives elsewhere (our `conversation`/`message` tables). Storing turns as memories both pollutes recall *and* duplicates the transcript.
> Source: [mem0 arXiv:2504.19413]

## Where the field disagrees / evidence is thin (be honest)

- **The famous mem0 "ADD/UPDATE/DELETE/NOOP" operation model did NOT verify against the primary paper** (0-3 refutation — it's repeated everywhere in secondary blogs but we couldn't confirm it from arXiv:2504.19413). Treat it as folklore; build consolidation from the *principle* (dedup/update/supersede), not that exact four-op API.
- **Extraction memory is not free accuracy.** A 2026 benchmark (arXiv:2603.04814) found long-context models beat extraction-based memory by **33+ points on LongMemEval accuracy**. The win is cost + latency, not correctness. For a low-volume consulting chat this is fine, but don't oversell it as "smarter."
- **Forgetting is unsolved.** No production system as of mid-2026 implements principled eviction (TTL / decay / LRU / compaction) as a first-class primitive. Staleness is the #1 real-world failure (arXiv:2605.06527: only 3.3% of stale entries get updated when new evidence arrives). We should ship *supersede-on-conflict* and leave decay as an explicit open question, not invent an unproven eviction model.
- Benchmarks are narrow (LOCOMO = 10 conversations). Don't over-index on the exact numbers.

## What Archos has today vs. the gap

| Pillar | Field best practice | Archos today | Gap |
|---|---|---|---|
| Store | Extracted atomic facts | Whole raw turns (`## User… ## Assistant…`) | **Big** — this is the pollution |
| Salience | Novel/conflict/dup gating | Store everything | **Big** — greetings + questions become "memories" |
| Consolidate | Update/supersede on conflict | None (append-only) | **Big** — "My name is Rob" stored 5× |
| Retrieve | Multi-signal score | `0.7·sim + 0.2·recency` | Small — sound, but reads a dirty store |
| Layer | Thin, transcript separate | Duplicates the transcript | Medium |
| Timing | Background worker | Synchronous fire-and-forget | Fine at our volume |

Recall + isolation are correct and shipped. The gap is entirely **capture quality**.

## Target design for our stack (pgvector-only, no graph DB)

1. **Extraction step at capture.** Replace "store the turn" with: a cheap LLM (e.g. `anthropic/claude-haiku-4.5` via OpenRouter — the same tier CulinAIre used for its distillation judge) reads the turn and returns 0–N standalone, third-person atomic facts as JSON (`[]` for greetings/questions → nothing stored). This alone fixes the "Your Brain" page.
2. **Consolidate before insert.** For each candidate fact: embed it, cosine-search the user's existing facts; **duplicate → skip, conflict → mark the old row `is_active=false, superseded_at=now()` and insert the new, novel → insert.** Add `is_active` + `superseded_at` columns to `user_memory`; recall filters `WHERE is_active`.
3. **Keep the multi-signal scorer** we already have; it now reads a clean store.
4. **Timing:** keep it in the existing fire-and-forget path (adds one Haiku call, sub-second, off the reply path). A background worker is the upgrade if that ever bites — not needed at consulting volume.
5. **Provenance:** the transcript already lives in `message`; the fact row optionally keeps a `source_conversation_id`. Do not store turns as memories.

Deliberately **out of scope** (thin evidence / not needed yet): knowledge graph, temporal graph traversal, TTL/decay eviction, memory-type taxonomy (semantic/episodic/procedural), org-shared memory. Revisit forgetting only if a user's fact count grows unbounded.

## Open questions (for the CEO/eng review to resolve)

- Extraction model tier: is Haiku 4.5 enough for consistent atomic-fact JSON without fine-tuning (AtomMem used a fine-tuned Qwen3-14B)? Needs a quick eval.
- Consolidation conflict detection: cosine-threshold + LLM adjudication, or LLM-judge only? Cost vs precision.
- Migration of the ~existing polluted memories: re-extract from the stored turns, or start clean?
- Do we ever need decay, or is supersede-on-conflict + a soft per-user cap enough?

## Sources (primary unless noted)

- mem0 — *Building Production-Ready AI Agents with Scalable Long-Term Memory*, ECAI 2025 — arXiv:2504.19413
- Zep/Graphiti — *A Temporal Knowledge Graph Architecture for Agent Memory* — arXiv:2501.13956
- AtomMem — arXiv:2606.19847 (Jun 2026; newest, not independently replicated)
- LangMem conceptual guide — langchain-ai.github.io/langmem/concepts/conceptual_guide
- Extraction-vs-long-context accuracy — arXiv:2603.04814
- Staleness failure mode (STALE) — arXiv:2605.06527
- Deterministic conflict resolution — arXiv:2606.01435
- Full verified finding set + refutations: deep-research run `wf_050f49c4-64d` (2026-07-19)
