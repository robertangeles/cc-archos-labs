import { describe, expect, it } from "vitest";
import { generatePreCallBrief } from "../../lib/claude-booking";

// Eval suite: pre-call brief prompt.
//
// Brief shape is: { summary, priorityScore P1/P2/P3, priorityReason,
// talkingPoints (exactly 3) }. Cases here exercise the scoring rubric
// across realistic prospect shapes — qualified+urgent CTO (P1),
// curious-but-not-decision-maker analyst (P3), mid-stack director with
// no deadline (P2).
//
// Brief is the single most load-bearing prompt — Rob reads it in 60s
// before every call. A regression here means worse calls. These cases
// fix the rubric calibration; add more as you encounter edge cases.

interface Fixture {
  name: string;
  input: {
    prospectName: string;
    prospectRole: string;
    prospectOrganisation: string;
    reasonInitial: string;
    followups: { question: string; answer: string }[];
  };
  expected: {
    priorityScore: "P1" | "P2" | "P3";
    // Talking points must mention at least one of these concept
    // anchors. Loose semantic check that the brief is actually
    // about THIS prospect, not generic advice.
    talkingPointsMustMention?: string[];
    // Phrases that signal generic / non-specific output. Caught
    // from prior failures.
    forbiddenInTalkingPoints?: string[];
    // Summary length sanity (the prompt asks for max 80 words).
    summaryMaxWords?: number;
  };
}

const FORBIDDEN_GENERIC = [
  "understand their goals",
  "discuss next steps",
  "build rapport",
  "qualify the opportunity",
  "explore use cases",
];

const FIXTURES: Fixture[] = [
  {
    name: "CTO at major bank, urgent migration → P1",
    input: {
      prospectName: "Sarah Lin",
      prospectRole: "CTO",
      prospectOrganisation: "Westpac Banking Corporation",
      reasonInitial:
        "Our core banking data warehouse migration to a cloud lakehouse is 4 weeks late and our AI risk-rating model can't ship without it. The board is asking whether to push the AI work or fix the migration. I have authority to redirect 6 engineers — I need an outside read on the actual sequencing risk.",
      followups: [
        {
          question:
            "What's the cost of waiting another quarter to ship the risk-rating model?",
          answer:
            "About $40M in extra regulatory capital we're holding because our manual scoring is conservative. The CEO wants this gone in Q3.",
        },
      ],
    },
    expected: {
      priorityScore: "P1",
      talkingPointsMustMention: [
        "migration",
        "lakehouse",
        "risk",
        "sequencing",
        "regulatory",
        "scoring",
      ],
      forbiddenInTalkingPoints: FORBIDDEN_GENERIC,
      summaryMaxWords: 100, // bit of slack on the 80-word target
    },
  },
  {
    name: "Junior analyst exploring → P3",
    input: {
      prospectName: "Tom Patel",
      prospectRole: "Data Analyst",
      prospectOrganisation: "(small fintech startup, 12 people)",
      reasonInitial:
        "Hi, I read your post on data architecture. I'm curious about AI agents and what they can do. We don't have any concrete project but I want to learn.",
      followups: [],
    },
    expected: {
      priorityScore: "P3",
      forbiddenInTalkingPoints: FORBIDDEN_GENERIC,
      summaryMaxWords: 100,
    },
  },
  {
    name: "Director with vague timeline → P2",
    input: {
      prospectName: "Anna Kowalski",
      prospectRole: "Director of Data Platforms",
      prospectOrganisation: "Mercy Health System",
      reasonInitial:
        "We're modernising our patient data platform across 14 hospitals. There's interest in AI for clinical decision support but governance is a mess and we haven't picked vendors. Director-level so I can scope but not commit budget beyond pilots.",
      followups: [],
    },
    expected: {
      priorityScore: "P2",
      talkingPointsMustMention: [
        "governance",
        "vendor",
        "hospital",
        "platform",
        "clinical",
        "pilot",
      ],
      forbiddenInTalkingPoints: FORBIDDEN_GENERIC,
      summaryMaxWords: 100,
    },
  },
  {
    name: "Operations VP with explicit deadline → P1",
    input: {
      prospectName: "James Wu",
      prospectRole: "VP Operations",
      prospectOrganisation: "Federal Department of Customer Services",
      reasonInitial:
        "We have a government mandate to reduce average call-handling time 20% by April 2027. I have $4M signed and my Minister has personally asked for monthly progress. I'm evaluating whether an AI triage agent or a data-driven routing rewrite gets us there faster.",
      followups: [
        {
          question: "Has any AI vendor been shortlisted yet?",
          answer:
            "Three: two from the panel, one we'd need to add. Nothing committed.",
        },
      ],
    },
    expected: {
      priorityScore: "P1",
      talkingPointsMustMention: [
        "triage",
        "routing",
        "call",
        "agent",
        "mandate",
        "vendor",
        "minister",
      ],
      forbiddenInTalkingPoints: FORBIDDEN_GENERIC,
      summaryMaxWords: 100,
    },
  },
  {
    name: "CEO of small startup → P2",
    input: {
      prospectName: "Priya Naidu",
      prospectRole: "CEO & Co-founder",
      prospectOrganisation: "Compli (12-person legal-tech startup)",
      reasonInitial:
        "We've raised a seed and want to use AI to summarise legal documents for clients. Our two engineers are unsure whether to build with OpenAI's API directly or use a wrapper. No data team yet. Need a sanity check on architecture before we commit code direction.",
      followups: [],
    },
    expected: {
      // Could go P1 or P2 — decision-maker + urgent enough that it's
      // worth Rob's time but not the kind of "$40M of risk capital
      // shipping next quarter" P1 case. Most prompts will land P2.
      priorityScore: "P2",
      talkingPointsMustMention: [
        "openai",
        "api",
        "wrapper",
        "architecture",
        "build",
        "vendor",
      ],
      forbiddenInTalkingPoints: FORBIDDEN_GENERIC,
      summaryMaxWords: 100,
    },
  },
];

describe("eval: pre-call brief", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const { brief, costUsd } = await generatePreCallBrief(fixture.input);

      expect(
        brief,
        "Claude returned null (parse/transient failure) — see lib/claude-booking.ts",
      ).not.toBeNull();
      if (!brief) return;

      expect(
        brief.priorityScore,
        `priorityScore mismatch for "${fixture.name}"`,
      ).toBe(fixture.expected.priorityScore);

      expect(brief.priorityReason.length).toBeGreaterThan(5);
      expect(brief.priorityReason.length).toBeLessThan(400);

      // Schema enforces exactly 3 talking points; verify the strings
      // aren't empty and not just whitespace.
      expect(brief.talkingPoints).toHaveLength(3);
      for (const point of brief.talkingPoints) {
        expect(point.trim().length).toBeGreaterThan(10);
      }

      // Talking-point anchors: at least ONE of the expected concept
      // words should appear across the 3 points. Catches "generic
      // advice that could apply to anyone" failures.
      if (fixture.expected.talkingPointsMustMention) {
        const allLower = brief.talkingPoints.join(" ").toLowerCase();
        const hasAny = fixture.expected.talkingPointsMustMention.some((t) =>
          allLower.includes(t.toLowerCase()),
        );
        expect(
          hasAny,
          `Talking points lack any anchor word from: ${fixture.expected.talkingPointsMustMention.join(", ")}\nGot: ${brief.talkingPoints.join(" | ")}`,
        ).toBe(true);
      }

      if (fixture.expected.forbiddenInTalkingPoints) {
        const allLower = brief.talkingPoints.join(" ").toLowerCase();
        for (const forbidden of fixture.expected.forbiddenInTalkingPoints) {
          expect(
            allLower,
            `Talking points contain generic phrase "${forbidden}"`,
          ).not.toContain(forbidden.toLowerCase());
        }
      }

      if (fixture.expected.summaryMaxWords) {
        const wordCount = brief.summary.trim().split(/\s+/).length;
        expect(
          wordCount,
          `Summary is ${wordCount} words (max ${fixture.expected.summaryMaxWords})`,
        ).toBeLessThanOrEqual(fixture.expected.summaryMaxWords);
      }

      console.log(
        `  cost: $${(costUsd ?? 0).toFixed(5)} — ${fixture.name} → ${brief.priorityScore}`,
      );
    });
  }
});
