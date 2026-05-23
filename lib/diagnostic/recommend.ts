import "server-only";
import { eq, inArray } from "drizzle-orm";
import { findSimilarPosts, type SimilarPost } from "../posts/find-similar";
import { generatePostGlosses } from "../posts/gloss";
import { getDb } from "../db";
import { category, post, reportOutput } from "../db/schema";
import {
  type ActionItem,
  type ReportContent,
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

// ============================================================================
// Side-effecting orchestration: retrieve → gloss → UPDATE report_output.
// Called from lib/diagnostic/report.ts#generateReport AFTER the report row
// has been inserted with NULL recommended_readings, gated by the
// RECOMMENDED_READINGS_ENABLED feature flag (D12).
//
// Fail-soft contract: this function NEVER throws. Any error logs and
// returns; the report row keeps its NULL recommended_readings and the
// render layer hides the readings block. The diagnostic generate
// response is unaffected.
// ============================================================================

/**
 * Build the context string sent to the gloss LLM. Joins verdict +
 * narrative + a compact list of action titles + explanations. The
 * gloss prompt uses this to tailor relevance notes to the reader's
 * actual situation.
 */
export function buildGlossContext(content: ReportContent): string {
  const actionsBlock = content.action_plan
    .map((a, i) => `${i + 1}. ${a.title}: ${a.explanation}`)
    .join("\n");
  return `${content.verdict}\n\n${content.narrative}\n\nActions:\n${actionsBlock}`;
}

export async function populateRecommendedReadings(
  reportId: string,
  content: ReportContent,
): Promise<void> {
  try {
    // 1. Per-action retrieval (with fallback per recommendForReport).
    const recs = await recommendForReport({
      verdict: content.verdict,
      narrative: content.narrative,
      actionPlan: content.action_plan,
    });
    if (recs.length === 0) {
      // No matches above threshold — leave NULL. Render layer hides
      // the readings block. Cold-start path.
      return;
    }

    // 2. Load post titles + excerpts so the gloss LLM has enough to
    //    write a relevance note. We already know the IDs from retrieval.
    const db = getDb();
    const postIds = Array.from(new Set(recs.map((r) => r.postId)));
    const postRows = await db
      .select({
        id: post.id,
        title: post.title,
        excerpt: post.excerpt,
      })
      .from(post)
      .where(inArray(post.id, postIds));

    // 3. Batched gloss call. Returns {} on any Claude error — caller
    //    must tolerate missing entries.
    const glossMap = await generatePostGlosses({
      context: buildGlossContext(content),
      posts: postRows.map((p) => ({
        id: p.id,
        title: p.title,
        excerpt: p.excerpt,
      })),
    });

    // 4. Merge glosses into the rec entries. Posts whose gloss the
    //    LLM omitted or hallucinated get an empty string — UI renders
    //    them without the subtitle.
    const withGloss: RecommendedReading[] = recs.map((r) => ({
      actionIndex: r.actionIndex,
      postId: r.postId,
      gloss: glossMap[r.postId] ?? "",
    }));

    // 5. Persist to report_output. Single UPDATE; if the row was
    //    deleted between INSERT and now (impossible in practice; the
    //    same caller just inserted it), the UPDATE is a no-op.
    await db
      .update(reportOutput)
      .set({
        recommendedReadings: withGloss,
        updatedAt: new Date(),
      })
      .where(eq(reportOutput.id, reportId));
  } catch (err) {
    // Logged at WARN, not ERROR — the report itself succeeded; readings
    // are a supplement, not a precondition.
    console.warn(
      "[diagnostic] populateRecommendedReadings failed; report saved without readings:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ============================================================================
// Hydration: turn the persisted RecommendedReading[] (just IDs + gloss +
// actionIndex) into UI-ready rows by joining against post + action_plan.
//
// Called from loadReport at render time, NOT at generation time. This way
// the UI always shows current post titles/excerpts/og-images — if an
// editor renames a post or replaces its image after the rec was persisted,
// the change is reflected without re-running retrieval. (D7 stability is
// about WHICH posts are recommended, not their display content.)
//
// Posts that no longer exist or are no longer published are filtered out
// silently — the render layer just shows fewer cards.
// ============================================================================

export interface HydratedRecommendedReading {
  postId: string;
  slug: string;
  title: string;
  excerpt: string | null;
  readingTimeMin: number;
  ogImagePath: string | null;
  ogImageDeletedAt: Date | null;
  ogImageAlt: string | null;
  categoryName: string | null;
  /** 0..N-1 = supports action_plan[i]; -1 = general recommendation. */
  actionIndex: number;
  /** action_plan[actionIndex].title when actionIndex >= 0; null otherwise. */
  actionTitle: string | null;
  /** One-sentence relevance note; "" when the gloss LLM degraded. */
  gloss: string;
}

export async function hydrateRecommendedReadings(
  rawReadings: RecommendedReading[] | null,
  actionPlan: ActionItem[],
): Promise<HydratedRecommendedReading[]> {
  if (!rawReadings || rawReadings.length === 0) return [];

  const db = getDb();
  const postIds = Array.from(new Set(rawReadings.map((r) => r.postId)));

  // One JOIN query for all referenced posts. Filters to published +
  // not-archived so unpublishing a post since the rec was persisted
  // silently drops that rec from the rendered list.
  const postRows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      readingTimeMin: post.readingTimeMin,
      ogImagePath: post.ogImagePath,
      ogImageDeletedAt: post.ogImageDeletedAt,
      ogImageAlt: post.ogImageAlt,
      status: post.status,
      archivedAt: post.archivedAt,
      categoryId: post.categoryId,
    })
    .from(post)
    .where(inArray(post.id, postIds));

  // Build category map separately to avoid a LEFT JOIN that complicates
  // the select shape. Categories are small (<20 rows in production); one
  // extra SELECT is cheaper than a join.
  const categoryIds = postRows
    .map((p) => p.categoryId)
    .filter((id): id is string => id !== null);
  const categoryRows =
    categoryIds.length > 0
      ? await db
          .select({ id: category.id, name: category.name })
          .from(category)
          .where(inArray(category.id, categoryIds))
      : [];
  const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));

  const postById = new Map(postRows.map((p) => [p.id, p]));

  const out: HydratedRecommendedReading[] = [];
  for (const r of rawReadings) {
    const p = postById.get(r.postId);
    if (!p) continue; // post deleted since rec was persisted — drop
    if (p.status !== "published") continue; // unpublished — drop
    if (p.archivedAt !== null) continue; // archived — drop

    const actionTitle =
      r.actionIndex >= 0 && r.actionIndex < actionPlan.length
        ? actionPlan[r.actionIndex].title
        : null;

    out.push({
      postId: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      readingTimeMin: p.readingTimeMin,
      ogImagePath: p.ogImagePath,
      ogImageDeletedAt: p.ogImageDeletedAt,
      ogImageAlt: p.ogImageAlt,
      categoryName: p.categoryId ? categoryById.get(p.categoryId) ?? null : null,
      actionIndex: r.actionIndex,
      actionTitle,
      gloss: r.gloss,
    });
  }
  return out;
}
