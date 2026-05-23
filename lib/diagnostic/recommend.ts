import "server-only";
import { findSimilarPosts, type SimilarPost } from "../posts/find-similar";
import {
  type ActionItem,
  SERVICE_LINE_LABELS,
} from "./report-types";
import type { RecommendedReading } from "../db/schema";

// ============================================================================
// Per-action retrieval pipeline for the Executive AI Diagnostic report.
//
// Strategy (CEO + Eng review locked):
//   1. For each ActionItem in action_plan, embed
//        `${title}. ${explanation} Service: ${SERVICE_LINE_LABELS[service_line]}`
//      and run an ANN search bounded by SIMILARITY_THRESHOLD (D8).
//   2. Run all per-action queries in parallel via Promise.allSettled —
//      one slow / errored action does not block the others.
//   3. Dedupe across actions: if the same post is the top-1 for two
//      actions, the FIRST action wins (preserves attribution order).
//   4. Cap at MAX_PER_REPORT (5) results total.
//   5. If after dedupe we have zero recs (every action's top-1 was
//      below threshold or threw), fall back to a single per-report
//      ANN query embedding `verdict + narrative` and return the top
//      MAX_FALLBACK (3) results with actionIndex = -1.
//   6. If even the fallback returns nothing, return [] — the render
//      layer hides the readings block entirely (quiet fail per D8).
//
// No LLM gloss in this module — that's a separate step in
// lib/posts/gloss.ts. This module only retrieves; gloss enrichment
// happens after.
// ============================================================================

/**
 * Cosine-distance threshold above which a post is considered too weak a
 * match to attach to an action. 0 = identical, 2 = opposite.
 *
 * Initial value is a reasonable starting point; should be calibrated
 * via scripts/calibrate-threshold.ts (per the eng review's E7 task)
 * once the eval bench (lib/diagnostic/recommend.eval.test.ts) has
 * enough cases to drive a data-informed choice. Tracked in TODOS.
 */
export const SIMILARITY_THRESHOLD = 0.6;

/** Maximum number of recommendations attached to a single report. */
export const MAX_PER_REPORT = 5;

/** Maximum number of fallback recs when per-action retrieval yields zero. */
export const MAX_FALLBACK = 3;

/** Input contract for the recommender. Subset of ReportContent. */
export interface RecommendForReportInput {
  verdict: string;
  narrative: string;
  actionPlan: ActionItem[];
}

/**
 * Compose the query text we embed for a given action. Kept as a pure
 * function so the eval bench can call it deterministically.
 */
export function buildActionQueryText(action: ActionItem): {
  title: string;
  excerpt: string | null;
  contentMd: string | null;
} {
  return {
    title: action.title,
    excerpt: action.explanation,
    // The service line label gives the embedder a useful anchor for
    // mapping abstract actions (e.g. "Document data lineage") to the
    // editorial domain Archos posts about ("Data Architecture").
    contentMd: `Service: ${SERVICE_LINE_LABELS[action.service_line]}`,
  };
}

/**
 * Run per-action retrieval and return RecommendedReading entries ready
 * to persist on report_output.recommended_readings. Pure orchestration;
 * does not write to the DB.
 */
export async function recommendForReport(
  input: RecommendForReportInput,
): Promise<RecommendedReading[]> {
  // Phase 1: parallel per-action ANN. Promise.allSettled ensures a
  // single failed action (embedding outage, DB blip) doesn't lose the
  // entire readings block — only that action's recommendation is lost.
  const perAction = await Promise.allSettled(
    input.actionPlan.map((action) =>
      findSimilarPosts({
        queryText: buildActionQueryText(action),
        maxDistance: SIMILARITY_THRESHOLD,
        limit: 1,
        visibility: "public",
      }),
    ),
  );

  // Phase 2: collect first match per action, deduping across actions.
  const seen = new Set<string>();
  const recs: RecommendedReading[] = [];
  for (let i = 0; i < perAction.length; i++) {
    const result = perAction[i];
    if (result.status !== "fulfilled") continue;
    const top = result.value[0];
    if (!top) continue;
    if (seen.has(top.id)) continue;
    seen.add(top.id);
    recs.push({
      actionIndex: i,
      postId: top.id,
      gloss: "", // populated downstream by lib/posts/gloss.ts
    });
    if (recs.length >= MAX_PER_REPORT) break;
  }

  if (recs.length > 0) return recs;

  // Phase 3: fallback — no action found a strong match. Embed the
  // verdict + narrative as a per-report query and surface up to
  // MAX_FALLBACK general reads. actionIndex = -1 signals "this post is
  // not tied to a specific action."
  let fallback: SimilarPost[] = [];
  try {
    fallback = await findSimilarPosts({
      queryText: {
        title: input.verdict,
        excerpt: input.narrative,
        contentMd: null,
      },
      maxDistance: SIMILARITY_THRESHOLD,
      limit: MAX_FALLBACK,
      visibility: "public",
    });
  } catch {
    // If even the fallback errors, return empty — render layer hides
    // the readings block (quiet fail per D8 cold-start handling).
    return [];
  }

  return fallback.map((p) => ({
    actionIndex: -1,
    postId: p.id,
    gloss: "",
  }));
}
