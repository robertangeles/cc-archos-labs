import "server-only";

// Structured, content-free telemetry for library retrieval.
//
// Mirrors lib/brain/observability.ts and lib/chat/attachments/observability.ts
// — same shape, new tag — rather than inventing a third pattern or a table.
//
// This exists because lib/chat/stream.ts:85 was a bare `catch {}`. Three
// completely different failures — the embed API being down, the database being
// unreachable, and the library genuinely having nothing on the topic — all
// landed there and were indistinguishable to both the user and the operator.
// Metis answered ungrounded and nothing anywhere recorded that it had.
//
// NEVER logs user content, query text, or chunk text. Source TITLES are logged:
// they are operationally essential (you cannot debug "why did it cite that?"
// without them) and the corpus is a fixed shelf the operator owns, not user
// data. Everything else is counts, scores and timings.

export interface RetrievalEvent {
  event: "retrieval";
  /** Which source-handling regime this turn ran under. */
  audience: "internal" | "client";
  /** How the sub-queries were produced. */
  strategy: "fanout" | "raw_fallback" | "short_turn_reuse";
  /** Why we fell back, when we did. Never the query text. */
  fallbackReason?:
    | "decompose_timeout"
    | "decompose_error"
    | "decompose_empty"
    | "decompose_malformed"
    | "self_contained"
    | "disabled";
  subQueries: number;
  /** Canonical domains targeted this turn. */
  domains: string[];
  /** Which path served each sub-query — a corpus quietly running on keyword
   *  search is slower and worse, and otherwise invisible. */
  paths: Array<"vector" | "keyword" | "failed">;
  /** Candidates before the floor, and how many the floor removed. */
  candidates: number;
  droppedBelowFloor: number;
  /** What actually reached the model. */
  chunks: number;
  distinctSources: number;
  sources: string[];
  topScore: number | null;
  medianScore: number | null;
  ms: number;
  decomposeMs: number | null;
  /** True when retrieval could not run, as distinct from finding nothing.
   *  These are different states and must never be conflated: one is a
   *  degraded service, the other is honest scoping. */
  degraded: boolean;
  reason?: string;
}

export function logRetrievalEvent(e: RetrievalEvent): void {
  console.log(JSON.stringify({ tag: "library_retrieval", ...e }));
}

/** A short, content-free reason from a thrown value. Retrieval failures are
 *  embed-API / DB errors, never user text — but cap length defensively. */
export function safeReason(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : "unknown";
}
