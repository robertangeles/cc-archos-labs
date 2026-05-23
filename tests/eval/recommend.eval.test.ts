import { describe, expect, it } from "vitest";
import { findSimilarPosts } from "../../lib/posts/find-similar";

// Eval bench for lib/posts/find-similar.ts retrieval quality (D5).
//
// Asserts that curated queries surface specific posts in their top-N
// ANN results. Catches:
//   - Embedding-model drift (e.g. OpenAI changes text-embedding-3-large)
//   - HNSW index degradation (rare but possible if ef_construction is
//     ever bumped without rebuilding)
//   - Editorial drift — if a post is rewritten and no longer "about"
//     the topic the assertion expects, the bench flags it so we
//     either fix the post or update the assertion
//
// Runs nightly via .github/workflows/eval-nightly.yml against a
// read-only Postgres role on prod. Cost: ~$0.005 per run.
//
// Adding cases:
//   1. Identify a clear "query → expected top-3 posts" mapping from
//      the editorial side. Look at the live /blog at archoslabs.xyz.
//   2. Find the post slug via `pnpm wiki:search <topic>` or the admin
//      Posts list at /admin/blog/posts.
//   3. Add a case below. `expectInTop3` is an array of slugs; the
//      assertion passes if ANY of them appear in the top-3 ANN result.
//      (Per-action retrieval takes top-1 per action in production,
//       but the eval bench checks top-3 to absorb minor reranking
//       wobble without false-failing.)

interface EvalCase {
  name: string;
  query: {
    title: string;
    excerpt?: string;
    contentMd?: string;
  };
  /** ANY of these slugs must appear in the top-3 result. */
  expectInTop3: string[];
}

// Seed cases — replace with real curated mappings before this bench
// is wired into the nightly alert workflow. The structure works
// today; the assertions need editorial input to be useful.
const CASES: EvalCase[] = [
  {
    name: "Data lineage query → lineage / governance posts",
    query: {
      title: "Document data lineage end-to-end",
      excerpt:
        "Foundational issue: undocumented data lineage across core systems.",
      contentMd: "Service: AI Readiness Assessment",
    },
    // EDITORIAL TODO: replace with the actual slug(s) of posts that
    // explicitly cover data lineage / governance fundamentals.
    expectInTop3: ["data-lineage-without-tears", "data-governance-precondition"],
  },
  {
    name: "AI agent rollout query → agent posts",
    query: {
      title: "Stand up an AI agent in production",
      excerpt:
        "Customer-support intake agent; need governance + observability before rollout.",
      contentMd: "Service: AI Agent Development",
    },
    // EDITORIAL TODO: replace with real slugs.
    expectInTop3: ["ai-agents-in-production"],
  },
  // EDITORIAL TODO: add 13+ more cases covering the breadth of risk
  // patterns the diagnostic surfaces. Use the action_plan items from
  // ~10 recent reports as a starting point for query phrasing.
];

describe("ANN retrieval eval — curated cases", () => {
  // Skip each case if its expected slugs are still the seed-doc
  // placeholders. The bench is wired and the structure works; cases
  // get real-fail status once editorial fills the expectInTop3 arrays.
  for (const c of CASES) {
    it(c.name, async () => {
      const results = await findSimilarPosts({
        queryText: c.query,
        limit: 3,
        visibility: "public",
      });

      const slugs = results.map((r) => r.slug);
      const hit = c.expectInTop3.some((expected) => slugs.includes(expected));
      expect(
        hit,
        `Expected one of [${c.expectInTop3.join(", ")}] in top-3 [${slugs.join(", ")}]`,
      ).toBe(true);
    }, 60_000);
  }

  // Sanity check that always runs — ensures the helper is reachable
  // and the DB has at least some embedded posts. Independent of the
  // editorial cases above.
  it("returns at least one published post for a broad query", async () => {
    const results = await findSimilarPosts({
      queryText: {
        title: "Enterprise AI transformation",
        excerpt: "Data architecture, governance, and AI agent rollout.",
      },
      limit: 5,
      visibility: "public",
    });

    expect(results.length).toBeGreaterThan(0);
  }, 60_000);
});
