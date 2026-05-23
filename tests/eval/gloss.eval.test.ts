import { describe, expect, it } from "vitest";
import { generatePostGlosses } from "../../lib/posts/gloss";

// Eval bench for lib/posts/gloss.ts.
//
// Asserts the prompt produces glosses that:
//   - Mention a concrete detail from the context (the risk / action)
//   - DO NOT contain templated AI-slop phrases ("this article
//     discusses", "you might find", "in this post", etc.)
//   - Stay within the 15-40 word range the prompt specifies
//
// Cost: ~$0.005 per eval run (one Claude call per case × 6 cases).
// Run via `pnpm eval` (vitest.eval.config.ts globs tests/eval/).
// Excluded from the default `pnpm test` pass so CI free tier stays free.
//
// Two retries built into vitest.eval.config.ts to absorb transient
// nulls / stochastic wobble. A genuinely broken prompt fails all 3
// attempts.

// Posts to gloss. Mix of explicit risk topics and craft topics so
// the bench covers both the easy ("data lineage" maps to a lineage
// post) and the harder ("change management" doesn't have an obvious
// post but the gloss should still be specific) cases.
const TEST_POSTS = [
  {
    id: "pid-lineage",
    title: "Data Lineage Without Tears",
    excerpt:
      "A practitioner's guide to documenting data lineage in enterprise programs.",
  },
  {
    id: "pid-governance",
    title: "Governance Is a Precondition, Not a Phase",
    excerpt:
      "Why treating data governance as a sprint always backfires.",
  },
  {
    id: "pid-agents",
    title: "AI Agents in Production: What Breaks First",
    excerpt: "Real failures from real AI agent rollouts.",
  },
];

const BANNED_PHRASES = [
  /this article discusses/i,
  /you might find/i,
  /in this (post|article)/i,
  /we explore/i,
  /learn how/i,
  /\bdiscover\b/i,
  /dive into/i,
  /delve into/i,
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

describe("Post-gloss eval — banned phrases", () => {
  it("output contains no AI-slop templates across all returned glosses", async () => {
    const result = await generatePostGlosses({
      context:
        "Your AI program has critical gaps in data lineage documentation. " +
        "Three of your five clusters show foundational issues.",
      posts: TEST_POSTS,
    });

    for (const [id, gloss] of Object.entries(result)) {
      for (const banned of BANNED_PHRASES) {
        expect(gloss, `Post ${id} gloss matched banned phrase ${banned}: "${gloss}"`)
          .not.toMatch(banned);
      }
    }
  }, 60_000);

  it("output stays within 15-40 word range per gloss", async () => {
    const result = await generatePostGlosses({
      context:
        "Critical risk: undocumented data lineage. Action: document end-to-end lineage in the next 30 days.",
      posts: TEST_POSTS,
    });

    for (const [id, gloss] of Object.entries(result)) {
      const wc = wordCount(gloss);
      expect(wc, `Post ${id} gloss has ${wc} words: "${gloss}"`)
        .toBeGreaterThanOrEqual(15);
      expect(wc, `Post ${id} gloss has ${wc} words: "${gloss}"`)
        .toBeLessThanOrEqual(40);
    }
  }, 60_000);
});

describe("Post-gloss eval — context specificity", () => {
  it("gloss for the lineage post mentions lineage or documentation", async () => {
    const result = await generatePostGlosses({
      context:
        "Critical risk surfaced: data lineage is undocumented across three core systems. " +
        "Action: document data lineage end-to-end before scaling AI agents.",
      posts: [TEST_POSTS[0]], // lineage post only
    });

    expect(result["pid-lineage"]).toBeDefined();
    // Lineage gloss should reference lineage / documentation /
    // tracking — the specific concept from the context. If it
    // doesn't, the prompt is producing generic copy.
    expect(result["pid-lineage"]).toMatch(/lineage|documenta|track|map/i);
  }, 60_000);

  it("gloss for the agents post mentions agents or production failures when context is agent rollout", async () => {
    const result = await generatePostGlosses({
      context:
        "Action: stand up an AI agent in production for customer support intake. " +
        "Concern: prior agent rollouts at peer firms have failed visibly.",
      posts: [TEST_POSTS[2]], // agents post only
    });

    expect(result["pid-agents"]).toBeDefined();
    expect(result["pid-agents"]).toMatch(
      /agent|production|fail|rollout|deploy/i,
    );
  }, 60_000);
});

describe("Post-gloss eval — hallucination defense (live)", () => {
  it("does not invent post ids that weren't in the input", async () => {
    const result = await generatePostGlosses({
      context: "Critical risk: data lineage. Action: document end-to-end.",
      posts: TEST_POSTS,
    });
    const inputIds = new Set(TEST_POSTS.map((p) => p.id));
    for (const id of Object.keys(result)) {
      expect(inputIds.has(id), `Hallucinated id "${id}" passed through`).toBe(
        true,
      );
    }
  }, 60_000);
});
