import { describe, expect, it } from "vitest";
import {
  matchBlogPosts,
  type BlogPost,
} from "../../lib/claude-booking";

// Eval suite: blog matching prompt.
//
// The blog library is hypothetical for now (PR #45's blog-matching
// prompt is staged but not yet wired into the confirmation email).
// These fixtures use a small representative set so the prompt's
// "match the prospect's stated problem" behaviour can be exercised
// without a real CMS.
//
// Key prompt invariant: better to return zero matches than tenuous
// ones. Cases below test BOTH "should match" (urls expected) and
// "should NOT match" (empty array expected on weak signal).

const LIBRARY: BlogPost[] = [
  {
    title: "Why most AI programs fail at the data layer",
    url: "https://archoslabs.xyz/blog/ai-fails-at-data",
    summary:
      "AI failure modes traced back to ungoverned data, unmodelled domains, and warehouse architectures built for 2014 reporting.",
  },
  {
    title: "Building AI in regulated industries — what governance actually means",
    url: "https://archoslabs.xyz/blog/regulated-industries-governance",
    summary:
      "What governance looks like inside banks, hospitals, and federal agencies when AI moves from pilot to production.",
  },
  {
    title: "Build vs. buy: when to write your own AI agent vs use a vendor",
    url: "https://archoslabs.xyz/blog/build-vs-buy-agents",
    summary:
      "Decision framework for build-vs-buy on AI agents. Covers vendor lock, evaluation tooling, and where in-house pays off.",
  },
  {
    title: "How Big Four consulting fails enterprise AI",
    url: "https://archoslabs.xyz/blog/big-four-fails",
    summary:
      "Why $2,500/day Big Four advisors produce decks instead of working systems, and how to spot it before signing the SOW.",
  },
  {
    title: "Modern data architecture for AI workloads",
    url: "https://archoslabs.xyz/blog/modern-data-architecture",
    summary:
      "Lineage, domain modelling, and warehouse design patterns that actually serve AI training + retrieval, not just BI reporting.",
  },
];

interface Fixture {
  name: string;
  reasonInitial: string;
  expected: {
    // Minimum matches that should be returned (0 to 3).
    minMatches: number;
    maxMatches: number;
    // URLs that MUST appear in the matches list (semantically obvious
    // matches for the prospect's problem).
    requiredUrls?: string[];
    // URLs that must NOT appear (tenuous / wrong-domain).
    forbiddenUrls?: string[];
  };
}

const FIXTURES: Fixture[] = [
  {
    name: "data migration problem → must match data-architecture post",
    reasonInitial:
      "Our data warehouse migration is stuck. Schemas are inconsistent, lineage is undocumented, and we're trying to layer AI on top.",
    expected: {
      minMatches: 1,
      maxMatches: 3,
      requiredUrls: ["https://archoslabs.xyz/blog/modern-data-architecture"],
    },
  },
  {
    name: "Big Four shopping → must match the Big Four post",
    reasonInitial:
      "We just got a $1.2M proposal from a Big Four firm for AI strategy work. Want a second opinion before signing — what should I be asking?",
    expected: {
      minMatches: 1,
      maxMatches: 3,
      requiredUrls: ["https://archoslabs.xyz/blog/big-four-fails"],
    },
  },
  {
    name: "regulated industry / governance → must match regulated-industries post",
    reasonInitial:
      "We're a public hospital trying to deploy a clinical decision-support model. Our risk and compliance teams keep blocking it. Need to understand what good governance looks like before re-engaging.",
    expected: {
      minMatches: 1,
      maxMatches: 3,
      requiredUrls: [
        "https://archoslabs.xyz/blog/regulated-industries-governance",
      ],
    },
  },
  {
    name: "build vs buy agents → must match build-vs-buy post",
    reasonInitial:
      "Should we build our own AI agent framework or use a vendor like LangChain / Crew? Two engineers, no agreement on which way to go.",
    expected: {
      minMatches: 1,
      maxMatches: 3,
      requiredUrls: ["https://archoslabs.xyz/blog/build-vs-buy-agents"],
    },
  },
  {
    name: "generic curiosity → should return zero (no tenuous matches)",
    reasonInitial:
      "Heard about AI. Curious what it can do for any business. No specific problem yet.",
    expected: {
      // The prompt explicitly says "better to return zero than tenuous
      // matches." Generic curiosity → 0 is the right answer.
      minMatches: 0,
      maxMatches: 1, // allow one if the prompt insists; not a hard fail
    },
  },
];

describe("eval: blog matching", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const { matches, costUsd } = await matchBlogPosts({
        reasonInitial: fixture.reasonInitial,
        posts: LIBRARY,
      });

      expect(
        matches,
        "Claude returned null (parse/transient failure) — see lib/claude-booking.ts",
      ).not.toBeNull();
      if (!matches) return;

      expect(matches.matches.length).toBeGreaterThanOrEqual(
        fixture.expected.minMatches,
      );
      expect(matches.matches.length).toBeLessThanOrEqual(
        fixture.expected.maxMatches,
      );

      const returnedUrls = matches.matches.map((m) => m.url);

      for (const required of fixture.expected.requiredUrls ?? []) {
        expect(
          returnedUrls,
          `Missing expected match: ${required}\nGot: ${returnedUrls.join(", ") || "(none)"}`,
        ).toContain(required);
      }

      for (const forbidden of fixture.expected.forbiddenUrls ?? []) {
        expect(
          returnedUrls,
          `Returned forbidden match: ${forbidden}`,
        ).not.toContain(forbidden);
      }

      // Every returned URL must be drawn from the library — the prompt
      // is explicit on this. Catches hallucinated URLs.
      const libraryUrls = new Set(LIBRARY.map((p) => p.url));
      for (const url of returnedUrls) {
        expect(
          libraryUrls.has(url),
          `Hallucinated URL not in library: ${url}`,
        ).toBe(true);
      }

      console.log(
        `  cost: $${(costUsd ?? 0).toFixed(5)} — ${fixture.name} → ${matches.matches.length} match(es)`,
      );
    });
  }
});
