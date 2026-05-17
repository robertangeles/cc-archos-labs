import { describe, expect, it } from "vitest";
import { generateConversationalFollowup } from "../../lib/claude-booking";

// Eval suite: intake follow-up prompt.
//
// Each fixture states the prospect's initial reason and what we expect
// the prompt to do. Cases are deliberately drawn from realistic shapes
// the booking form will see in the wild — vague exploratory pings,
// crisp problem statements with deadlines, "I just want to chat" no-ops.
//
// Checks per case:
//   - Output validates against the Zod schema (always)
//   - shouldFollowUp matches expectation (sometimes "should ask",
//     sometimes "should pass through")
//   - When asking, the question avoids known filler patterns
//   - Question length is reasonable (not a paragraph)
//
// Add more fixtures here as you see edge cases the prompt mishandles.
// Cost: each `pnpm eval` run hits Claude once per fixture (~$0.003
// each on Sonnet). 5 cases ≈ $0.015.

interface Fixture {
  name: string;
  reasonInitial: string;
  expected: {
    shouldFollowUp: boolean;
    // Phrases the follow-up question must NOT contain (case-insensitive).
    // Caught from prior failures: filler / lazy questions.
    forbiddenInQuestion?: string[];
    // The question (if asked) must mention at least one of these
    // concept anchors. Loose semantic check.
    questionMustMention?: string[];
  };
}

const FORBIDDEN_FILLER = [
  "tell me more",
  "anything else",
  "can you elaborate",
  "what else",
  "could you share",
];

const FIXTURES: Fixture[] = [
  {
    name: "vague exploration — should ask sharpening question",
    reasonInitial: "We're thinking about AI",
    expected: {
      shouldFollowUp: true,
      forbiddenInQuestion: FORBIDDEN_FILLER,
    },
  },
  {
    name: "crisp specific problem with deadline — minimal probe needed",
    reasonInitial:
      "Our core banking data warehouse migration is 4 weeks late and the board is asking why our AI risk-rating pilot can't ship in October. I need to know whether to push the AI work or fix the migration first.",
    expected: {
      // Specific + has a deadline + has decision context — follow-up
      // might still be useful but shouldn't be a generic "tell me more"
      // either way.
      shouldFollowUp: false,
      forbiddenInQuestion: FORBIDDEN_FILLER,
    },
  },
  {
    name: "generic AI-curious — should ask for concrete problem",
    reasonInitial:
      "I want to understand what AI can do for our hospital network. We've got a mix of legacy EHR systems and our data team is small.",
    expected: {
      shouldFollowUp: true,
      forbiddenInQuestion: FORBIDDEN_FILLER,
      // Should probe toward something concrete — urgency, scope, or
      // decision authority.
      questionMustMention: [
        "what",
        "which",
        "who",
        "when",
        "specific",
        "problem",
        "deadline",
        "decision",
        "scope",
      ],
    },
  },
  {
    name: "mid-engagement context — should probe authority/scope",
    reasonInitial:
      "We hired a Big Four firm 8 months ago to do AI strategy work. They've produced two roadmap decks. Nothing has shipped. I want a second opinion before signing the renewal.",
    expected: {
      shouldFollowUp: true,
      forbiddenInQuestion: FORBIDDEN_FILLER,
    },
  },
  {
    name: "single line, very specific — could go either way",
    reasonInitial:
      "Help us evaluate whether our risk-modelling team should build vs buy an LLM eval framework. Decision needed by month-end.",
    expected: {
      // Specific scope + deadline → shouldn't need to probe much.
      shouldFollowUp: false,
      forbiddenInQuestion: FORBIDDEN_FILLER,
    },
  },
];

describe("eval: intake follow-up", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const { followup, costUsd } = await generateConversationalFollowup({
        reasonInitial: fixture.reasonInitial,
      });

      // Soft-fail on Claude errors — graceful-fallback returns null.
      // Eval failures should be about prompt quality, not transient
      // API issues. If Claude is unreachable, the booking flow
      // degrades to a static intake; the eval should make this
      // observable, not just crash.
      expect(
        followup,
        "Claude returned null (parse/transient failure) — see lib/claude-booking.ts",
      ).not.toBeNull();
      if (!followup) return;

      // shouldFollowUp expectation. We treat this as a soft assertion
      // because the prompt can legitimately make different judgement
      // calls — but a regression where every case suddenly flips
      // shouldFollowUp is the signal we want.
      expect(
        followup.shouldFollowUp,
        `shouldFollowUp mismatch for "${fixture.name}"`,
      ).toBe(fixture.expected.shouldFollowUp);

      if (followup.shouldFollowUp) {
        expect(followup.question.length).toBeGreaterThan(10);
        expect(followup.question.length).toBeLessThan(400);

        for (const forbidden of fixture.expected.forbiddenInQuestion ?? []) {
          expect(
            followup.question.toLowerCase(),
            `Question contains filler phrase "${forbidden}"`,
          ).not.toContain(forbidden.toLowerCase());
        }

        if (fixture.expected.questionMustMention) {
          const lower = followup.question.toLowerCase();
          const hasAny = fixture.expected.questionMustMention.some((t) =>
            lower.includes(t.toLowerCase()),
          );
          expect(
            hasAny,
            `Question lacks any anchor word from: ${fixture.expected.questionMustMention.join(", ")}`,
          ).toBe(true);
        }
      } else {
        // shouldFollowUp=false → empty question per the schema.
        expect(followup.question).toBe("");
      }

      // Surface cost so a tight eval loop's spend stays visible.
      console.log(
        `  cost: $${(costUsd ?? 0).toFixed(5)} — ${fixture.name}`,
      );
    });
  }
});
