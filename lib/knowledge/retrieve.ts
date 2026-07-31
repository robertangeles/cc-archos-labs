import "server-only";
import { OPENROUTER_URL, buildAuthHeaders } from "../llm/config";
import { keywordSearch, vectorSearch, type SearchResult } from "./search";
import {
  logRetrievalEvent,
  safeReason,
  type RetrievalEvent,
} from "./observability";

// Multi-perspective retrieval over the practice library.
//
// THE PROBLEM THIS SOLVES, measured rather than assumed:
//
//   TODAY  vectorSearch(rawTurn, undefined, 5)   avg 1.72 distinct books/turn
//                                                8 of 18 turns single-source
//
// One query embedding lands in one neighbourhood. A consulting question spans
// Block on framing the intervention, DMBOK on the governance model, and
// Maister on why the client is defensive — and nothing in the old path made
// three books more likely than one. Not impossible (one measured query did
// return three), just not guaranteed, and usually not what happened.
//
// Two independent levers, and this module uses both:
//   FAN-OUT  several sub-queries -> several different neighbourhoods
//   MERGE    a per-document cap so one book cannot fill every slot
//
// The merge is a pure function over SearchResult[] and is unit-tested directly.
// Only decomposition and the searches touch the network.

export const CANONICAL_DOMAINS = [
  "dmbok",
  "consulting",
  "engineering",
  "analytics",
  "startup",
] as const;
export type Domain = (typeof CANONICAL_DOMAINS)[number];

// Calibrated against the real 19-book corpus, not guessed. See
// wiki/decisions/2026-07-31-retrieval-floor-calibration.md.
//
// The previous floor of 0.3 never fired — all 25 sampled chunks cleared it, so
// it could not distinguish "strong match" from "nothing relevant" and the
// gap-signal branch was unreachable. At 0.42, questions the library covers
// return >=15 chunks above the line while questions it cannot answer peak at 8.
export const DEFAULT_FLOOR = 0.42;

// Below this many chunks above the floor, the library does not meaningfully
// cover the question. Answerable questions cleared it with >=15, unanswerable
// peaked at 8; 12 sits in the gap with margin on both sides. Consumed by the
// gap signal (E8a) — exported here so one number governs both.
export const COVERAGE_GATE = 12;

export interface RetrieveOptions {
  floor?: number;
  /** Candidates fetched per sub-query. Wider than the final K on purpose: the
   *  per-document cap needs alternatives to choose from, and a narrow pool
   *  makes the cap a no-op. */
  perQueryK?: number;
  finalK?: number;
  maxPerDoc?: number;
  maxSubQueries?: number;
}

const DEFAULTS: Required<RetrieveOptions> = {
  floor: DEFAULT_FLOOR,
  // 3 sub-queries x 12 = ~36 candidates, matching the K=30 that measured best.
  // A narrow pool starves the per-document cap: at K=8 diversity is 2.13 books,
  // at K=12 it is 2.88, at K=30 it is 3.88. The cap needs alternatives.
  perQueryK: 12,
  finalK: 8,
  maxPerDoc: 2,
  maxSubQueries: 3,
};

export interface SubQuery {
  query: string;
}

export interface MergeResult {
  chunks: SearchResult[];
  droppedBelowFloor: number;
}

/**
 * Merge candidates from every sub-query into the final set.
 *
 * PURE. No network, no clock, no randomness — so the whole ranking policy is
 * unit-testable without mocking an embedding API.
 */
export function mergeDiverse(
  pool: SearchResult[],
  opts: RetrieveOptions = {},
): MergeResult {
  const o = { ...DEFAULTS, ...opts };

  // 1. floor
  const aboveFloor = pool.filter((c) => c.similarity > o.floor);
  const droppedBelowFloor = pool.length - aboveFloor.length;

  // 2. dedupe — the same chunk can surface for more than one sub-query, and
  //    counting it twice would let one passage crowd out a whole book.
  const byId = new Map<string, SearchResult>();
  for (const c of aboveFloor) {
    const seen = byId.get(c.chunkId);
    if (!seen || c.similarity > seen.similarity) byId.set(c.chunkId, c);
  }

  // 3. sort by relevance
  const sorted = [...byId.values()].sort((a, b) => b.similarity - a.similarity);

  // 4-5. greedy fill with a per-document cap. This is the step that does the
  //      heavy lifting: measured 1.72 -> 3.83 distinct books on its own.
  const perDoc = new Map<string, number>();
  const picked: SearchResult[] = [];
  for (const c of sorted) {
    const n = perDoc.get(c.documentId) ?? 0;
    if (n >= o.maxPerDoc || picked.length >= o.finalK) continue;
    perDoc.set(c.documentId, n + 1);
    picked.push(c);
  }

  return { chunks: picked, droppedBelowFloor };
}

// STEP 6 ("diversity swap") WAS HERE AND HAS BEEN DELETED.
//
// The design called for: if fewer than three documents are represented, trade
// the weakest chunk of the dominant document for a candidate from an
// unrepresented one. It was written, unit-tested, and then measured against the
// real corpus:
//
//   swap fired on           0/8 questions
//   diversity gain          +0.00 books
//
// It never fired on a healthy pool, because steps 1-5 already produce 3.9
// distinct sources. It could only ever have fired on degraded paths, where it
// would have forced in a lower-scoring chunk to satisfy a document count — and
// that count is the eval harness's own primary metric, making it a heuristic
// tuned to the measure that judges it.
//
// The kill criterion was written into the code before the measurement, and the
// measurement met it. Deleted rather than kept "just in case".

// ── Decomposition ──────────────────────────────────────────────────────────

// A dedicated cheap model, mirroring BRAIN_EXTRACTION_MODEL in
// lib/brain/distill.ts. Deliberately NOT resolveLlmConfig() — that returns the
// admin-configured CHAT model, which would make this a second full-price call
// on every single turn.
function decomposeModel(): string {
  return process.env.RETRIEVAL_DECOMPOSE_MODEL?.trim() || "anthropic/claude-haiku-4.5";
}

// Measured: Haiku takes 1.5-1.8s for this call. An earlier 700ms budget timed
// out on EVERY turn, which silently reduced retrieval to a single raw query at
// the starved K=12 — worse than doing nothing clever at all.
const DECOMPOSE_TIMEOUT_MS = 2500;
const MIN_TURN_CHARS = 24;

// Rewriting is NOT worth 1.8s on every turn, and it does not need to be.
// Measured separately:
//   long self-contained question, raw turn at K=30   3.88 distinct books
//   context-dependent follow-up, raw turn            top-1 0.421, 2/4 below floor
//   the same follow-up, rewritten                    top-1 0.617, 4/4 above floor
//
// So the rewrite earns its latency exactly where the turn cannot stand alone,
// and nowhere else. A long question that already reads as a search query skips
// the call entirely and goes straight to a wide single-query search.
const REFERENTIAL =
  /\b(that|those|it|this|they|them|the (?:same|above|other|first|second|last))\b|^\s*(?:what about|how about|and|but|so|ok|okay|right|go on|continue|more on|why|and what)\b/i;
const SELF_CONTAINED_CHARS = 80;

export function needsRewrite(turn: string): boolean {
  const t = turn.trim();
  if (t.length < SELF_CONTAINED_CHARS) return true;
  return REFERENTIAL.test(t);
}

// No domain tagging, deliberately. Measured: filtering each sub-query to a
// topic domain DROPPED diversity from 3.88 to 3.38 distinct books, because the
// shelves are uneven — engineering holds 10 books, analytics 2 — so a
// domain-scoped search returns chunks concentrated in fewer documents. The
// angles below do the same job by varying the QUERY rather than the filter.
const DECOMPOSE_SYSTEM =
  "Rewrite the user's latest message into at most 3 short search queries for a " +
  "consulting reference library, using the earlier turns only to resolve what " +
  "the message refers to. A message like \"what about the governance angle?\" " +
  "must become a self-contained query.\n\n" +
  'Return ONLY JSON: {"queries":["...","..."]}\n\n' +
  "Aim for queries that surface DIFFERENT kinds of material — the " +
  "people/relationship angle, the technical angle, the governance angle — " +
  "rather than three rewordings of one idea.";

export interface DecomposeResult {
  subQueries: SubQuery[];
  fallbackReason?: RetrievalEvent["fallbackReason"];
  ms: number;
}

/**
 * Turn the latest message plus recent context into sub-queries.
 *
 * This is also the query rewriting the old path lacked entirely: "what about
 * the governance angle?" was previously embedded as those literal words.
 *
 * Every failure path returns the raw turn as a single untagged query — i.e.
 * exactly today's behaviour. Degrading to today is always safe, and that
 * property is what makes this change low-risk to ship.
 */
export async function decomposeQuery(
  turn: string,
  history: Array<{ role: string; content: string }>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DecomposeResult> {
  const started = Date.now();
  const raw = (reason?: RetrievalEvent["fallbackReason"]): DecomposeResult => ({
    subQueries: [{ query: turn }],
    fallbackReason: reason,
    ms: Date.now() - started,
  });

  const recent = history
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), DECOMPOSE_TIMEOUT_MS),
  );

  try {
    const call = (async () => {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: buildAuthHeaders(apiKey),
        body: JSON.stringify({
          model: decomposeModel(),
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: DECOMPOSE_SYSTEM },
            {
              role: "user",
              content: `${recent ? `Earlier:\n${recent}\n\n` : ""}Latest message:\n${turn.slice(0, 1500)}`,
            },
          ],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`decompose HTTP ${res.status}`);
      const j = await res.json();
      return j.choices?.[0]?.message?.content ?? "";
    })();

    const content = await Promise.race([call, timeout]);
    if (content === null) return raw("decompose_timeout");
    if (!content) return raw("decompose_empty");

    // Models wrap JSON in a markdown fence often enough that a bare parse is a
    // coin flip — observed here even with response_format: json_object set.
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : content;
    const objStart = candidate.indexOf("{");
    const objEnd = candidate.lastIndexOf("}");
    if (objStart === -1 || objEnd <= objStart) return raw("decompose_malformed");
    const parsed = JSON.parse(candidate.slice(objStart, objEnd + 1)) as {
      queries?: unknown;
    };
    if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) {
      return raw("decompose_malformed");
    }

    // Accept both a bare string and {query} — models drift between the two and
    // a rejected shape would silently cost the rewrite for that turn.
    const subQueries: SubQuery[] = [];
    for (const q of parsed.queries.slice(0, DEFAULTS.maxSubQueries)) {
      const text =
        typeof q === "string"
          ? q.trim()
          : typeof (q as { query?: unknown }).query === "string"
            ? String((q as { query: string }).query).trim()
            : "";
      if (text) subQueries.push({ query: text.slice(0, 500) });
    }

    if (subQueries.length === 0) return raw("decompose_malformed");
    return { subQueries, ms: Date.now() - started };
  } catch (err) {
    if (signal?.aborted) throw err;
    return raw(
      String(err).includes("HTTP") ? "decompose_error" : "decompose_malformed",
    );
  }
}

// ── Orchestration ──────────────────────────────────────────────────────────

export interface RetrieveArgs {
  turn: string;
  history: Array<{ role: string; content: string }>;
  apiKey: string;
  audience: "internal" | "client";
  /** Retrieval set from the previous turn, reused for short acknowledgements
   *  ("ok", "go on") rather than paying a decompose + 3 searches for noise. */
  previous?: SearchResult[];
  signal?: AbortSignal;
  options?: RetrieveOptions;
}

export interface RetrieveResult {
  chunks: SearchResult[];
  /** Distinct documents represented — the metric this module exists to move. */
  distinctSources: number;
  /** Chunks above the floor across the whole candidate pool. Compared against
   *  COVERAGE_GATE to decide whether the library actually covers the question. */
  aboveFloor: number;
  covered: boolean;
  /** Retrieval could not run, as opposed to finding nothing. Different states,
   *  different user-facing treatment. */
  degraded: boolean;
}

export function isFanoutEnabled(): boolean {
  return process.env.RETRIEVE_FANOUT_ENABLED === "true";
}

/**
 * Retrieve library material for one turn.
 *
 * Never throws. Every failure degrades to a smaller, well-defined result and is
 * reported through `degraded` and the telemetry — because the failure mode this
 * replaces was a bare `catch {}` that made a broken embedding API and an empty
 * library look identical.
 */
export async function retrieve(args: RetrieveArgs): Promise<RetrieveResult> {
  const started = Date.now();
  const o = { ...DEFAULTS, ...args.options };
  const emit = (e: Partial<RetrievalEvent>) =>
    logRetrievalEvent({
      event: "retrieval",
      audience: args.audience,
      strategy: "fanout",
      subQueries: 0,
      domains: [],
      paths: [],
      candidates: 0,
      droppedBelowFloor: 0,
      chunks: 0,
      distinctSources: 0,
      sources: [],
      topScore: null,
      medianScore: null,
      ms: Date.now() - started,
      decomposeMs: null,
      degraded: false,
      ...e,
    });

  // Short acknowledgements carry no retrievable intent. Reusing the previous
  // turn's set costs nothing and avoids a decompose call plus three searches
  // for "ok".
  if (args.turn.trim().length < MIN_TURN_CHARS && args.previous?.length) {
    const sources = new Set(args.previous.map((c) => c.documentId));
    emit({
      strategy: "short_turn_reuse",
      chunks: args.previous.length,
      distinctSources: sources.size,
      sources: [...new Set(args.previous.map((c) => c.title))],
    });
    return {
      chunks: args.previous,
      distinctSources: sources.size,
      aboveFloor: args.previous.length,
      covered: args.previous.length >= COVERAGE_GATE,
      degraded: false,
    };
  }

  let decomposed: DecomposeResult;
  if (isFanoutEnabled() && needsRewrite(args.turn)) {
    decomposed = await decomposeQuery(args.turn, args.history, args.apiKey, args.signal);
  } else {
    decomposed = {
      subQueries: [{ query: args.turn }],
      fallbackReason: isFanoutEnabled() ? "self_contained" : "disabled",
      ms: 0,
    };
  }

  // A single query needs a WIDE net; several narrow ones each cover their own
  // neighbourhood. Measured on one query: K=8 -> 2.13 books, K=12 -> 2.88,
  // K=30 -> 3.88. Using the multi-query K for a single query is what starved
  // the fallback path.
  const perQueryK =
    decomposed.subQueries.length === 1
      ? Math.max(o.perQueryK, 30)
      : o.perQueryK;

  const paths: RetrievalEvent["paths"] = [];
  const settled = await Promise.all(
    decomposed.subQueries.map(async (sq) => {
      // Deliberately NOT searchKnowledge. That helper catches a vector failure
      // and silently retries with keyword search, so a dead embedding API
      // returns results and looks entirely healthy — measured: an invalid API
      // key produced 4 chunks and degraded=false. The fallback is worth having;
      // being unable to SEE it is not. Doing it here means `paths` reports what
      // actually served, and a total embed outage is reported as degraded.
      //
      // No category filter — see DECOMPOSE_SYSTEM. vectorSearch still accepts
      // one for the CDMP path and the search_library tool, where scoping is the
      // caller's explicit intent rather than a heuristic.
      try {
        const rows = await vectorSearch(sq.query, undefined, perQueryK);
        paths.push("vector");
        return rows;
      } catch (vectorErr) {
        try {
          const rows = await keywordSearch(sq.query, undefined, perQueryK);
          paths.push("keyword");
          return rows;
        } catch {
          paths.push("failed");
          return { error: safeReason(vectorErr) } as const;
        }
      }
    }),
  );

  const failures = settled.filter((r): r is { error: string } => "error" in r);
  const pool = settled.filter((r): r is SearchResult[] => Array.isArray(r)).flat();

  // Every sub-query failed — retrieval is DOWN, which is a different state from
  // the library having nothing. The caller must be able to tell them apart.
  if (pool.length === 0 && failures.length > 0) {
    emit({
      strategy: decomposed.fallbackReason ? "raw_fallback" : "fanout",
      fallbackReason: decomposed.fallbackReason,
      subQueries: decomposed.subQueries.length,
      paths,
      decomposeMs: decomposed.ms,
      degraded: true,
      reason: failures[0].error,
    });
    return { chunks: [], distinctSources: 0, aboveFloor: 0, covered: false, degraded: true };
  }

  // Every sub-query fell back to keyword: the DB is up but the embedding API is
  // not. Results came back, so this is not "no coverage" — but it is degraded
  // semantic retrieval and the operator has to be able to see it.
  const allKeyword = paths.length > 0 && paths.every((p) => p === "keyword");

  // SCORE SCALES DO NOT MATCH. vectorSearch returns cosine similarity (0-1);
  // keywordSearch returns a points total (10 per title hit, 3 per content hit)
  // that routinely lands in the tens. So on the keyword path every candidate
  // clears the 0.42 floor and `covered` is meaningless — observed topScore 31.
  //
  // Not normalised here on purpose: inventing a mapping between "cosine 0.6"
  // and "13 points" would be a fabricated equivalence, and the keyword path is
  // already flagged `degraded`, which stream.ts treats as its own state ahead
  // of coverage. Fix it properly if keyword search ever becomes a primary path.

  const merged = mergeDiverse(pool, o);
  const aboveFloor = pool.filter((c) => c.similarity > o.floor).length;
  const scores = merged.chunks.map((c) => c.similarity);
  const sources = [...new Set(merged.chunks.map((c) => c.title))];

  emit({
    strategy: decomposed.fallbackReason ? "raw_fallback" : "fanout",
    fallbackReason: decomposed.fallbackReason,
    subQueries: decomposed.subQueries.length,
    paths,
    candidates: pool.length,
    droppedBelowFloor: merged.droppedBelowFloor,
    chunks: merged.chunks.length,
    distinctSources: sources.length,
    sources,
    topScore: scores.length ? Math.max(...scores) : null,
    medianScore: scores.length ? median(scores) : null,
    decomposeMs: decomposed.ms,
    degraded: allKeyword,
    reason: allKeyword ? "vector search unavailable; keyword fallback served" : undefined,
  });

  return {
    chunks: merged.chunks,
    distinctSources: sources.length,
    aboveFloor,
    covered: aboveFloor >= COVERAGE_GATE,
    degraded: allKeyword,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
