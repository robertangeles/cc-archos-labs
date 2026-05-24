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
// Run locally via `pnpm eval` (uses .env.local for DATABASE_URL +
// OpenRouter credentials). Treated as a developer-side gate before
// merging any PR that touches retrieval (lib/posts/find-similar.ts,
// lib/embeddings.ts, lib/diagnostic/recommend.ts) — matching the
// pattern the other eval suites under tests/eval/ follow. No CI
// automation; secrets stay in the integration-config DB, not GH
// Actions. Cost: ~$0.005 per run.
//
// Adding cases:
//   1. Identify a clear "query → expected top-3 posts" mapping from
//      the editorial side. Run `pnpm calibrate:threshold` to see
//      what the live retrieval pipeline returns for a query, and
//      use those slugs (or a subset) as `expectInTop3`.
//   2. The assertion passes if ANY of the listed slugs appears in
//      the top-3 ANN result — gives the eval some give without
//      becoming a no-op. Per-action retrieval takes top-1 in
//      production; checking top-3 here absorbs minor reranking
//      wobble.
//   3. Bench cases were last grounded against live retrieval on
//      2026-05-24 via scripts/calibrate-threshold.ts. Slugs below
//      are real prod slugs as of that date.

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

const CASES: EvalCase[] = [
  {
    name: "data lineage documentation → lineage/governance posts",
    query: {
      title: "Document data lineage end-to-end",
      excerpt:
        "Foundational issue: undocumented data lineage across core systems blocks AI initiatives.",
      contentMd: "Service: AI Readiness Assessment",
    },
    expectInTop3: [
      "ai-readiness-assessment-score-data-before-funding",
      "ai-integration-stages-enterprise-systems",
      "lineage-that-leaders-trust",
      "data-observability-ai",
    ],
  },
  {
    name: "AI agent production rollout → agent architecture posts",
    query: {
      title: "Stand up an AI agent in production",
      excerpt:
        "Customer-support intake agent; need governance + observability before rollout.",
      contentMd: "Service: AI Agent Development",
    },
    expectInTop3: [
      "agent-roadmap-2026-sequencing-guardrails-upgrades",
      "ai-agent-architecture",
      "ai-agent-pilot-template-90-day-stage-gates-redlines-exit-criteria",
    ],
  },
  {
    name: "data architecture redesign → modern architecture posts",
    query: {
      title: "Redesign the analytics warehouse for AI workloads",
      excerpt:
        "Existing star schema is brittle; AI queries hit hot spots and cause analyst delays.",
      contentMd: "Service: Data Architecture",
    },
    expectInTop3: [
      "modern-data-architecture-genai",
      "cost-aware-architecture-business-outcomes",
      "dimensional-modeling-for-agents",
    ],
  },
  {
    name: "data governance program → governance framework posts",
    query: {
      title: "Establish a data governance program",
      excerpt:
        "Cross-functional governance across data, AI, and risk teams.",
      contentMd: "Service: AI Readiness Assessment",
    },
    expectInTop3: [
      "ai-governance-framework-moving-fast",
      "ai-governance-framework-for-executives",
      "how-to-operationalise-data-governance-for-ai",
    ],
  },
  {
    name: "change management resistance → org/people-focused posts",
    query: {
      title: "Drive change management across the org",
      excerpt:
        "AI rollout meeting resistance from analytics team; product owners not bought in.",
      contentMd: "Service: AI Readiness Assessment",
    },
    expectInTop3: [
      "ai-change-management",
      "ai-trust",
      "ai-doesnt-scale-until-your-org-does-why-teams-fail-models",
    ],
  },
  {
    name: "model evaluation strategy → eval/pilot framework posts",
    query: {
      title: "Build an evaluation framework for production AI",
      excerpt:
        "Need to measure model quality continuously; not just at launch.",
      contentMd: "Service: AI Agent Development",
    },
    expectInTop3: [
      "ai-agent-pilot-template-90-day-stage-gates-redlines-exit-criteria",
      "agent-roadmap-2026-sequencing-guardrails-upgrades",
      "ai-use-case-prioritization-that-actually-scales",
    ],
  },
  {
    name: "executive AI strategy → exec-focused strategy posts",
    query: {
      title: "Set executive-level AI strategy and KPIs",
      excerpt:
        "CEO wants AI as a strategic differentiator; needs measurable goals.",
      contentMd: "Service: AI Readiness Assessment",
    },
    expectInTop3: [
      "from-ai-hype-to-ai-strategy",
      "executive-ai-literacy",
      "ceo-ai-strategy",
    ],
  },
  {
    name: "data quality remediation → quality/data-strategy posts",
    query: {
      title: "Address data quality issues blocking AI",
      excerpt:
        "Source data has gaps, inconsistencies; downstream models inherit them.",
      contentMd: "Service: Data Architecture",
    },
    expectInTop3: [
      "data-quality-ai-scaling",
      "data-strategy-ai",
      "data-unification-ai-production",
      "bad-data-is-a-strategic-liability",
    ],
  },
];

describe("ANN retrieval eval — curated cases", () => {
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
  // curated cases above.
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
