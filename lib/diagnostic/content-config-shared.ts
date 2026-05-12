import { z } from "zod";
import type {
  DomainWeights,
  PriorityTrigger,
  Question,
  RiskFlagRule,
  TierBoundary,
} from "./types";

// Client-safe types + Zod schema + fallback for the diagnostic content
// row. Server-only loader lives in lib/diagnostic/content-config.ts.
// Admin UI imports from here so no server modules leak to the client.
//
// One row in site_setting keyed 'diagnostic_content'. JSONB value
// matches DiagnosticContentSchema.
//
// Same pattern as prompt-config-shared (D-26): real practitioner-tuned
// values live in the admin row; the source file ships a thin generic
// fallback so the app boots on a fresh clone but won't generate the
// real product without an admin seed.

// ----------------------------------------------------------------------------
// Zod schemas — strict enough to catch obvious bad pastes, loose enough
// not to require updating both source and admin for minor copy changes.
// ----------------------------------------------------------------------------

const AnswerCodeSchema = z.enum(["A", "B", "C", "D", "E"]);

const AnswerOptionSchema = z.object({
  code: AnswerCodeSchema,
  label: z.string().min(1).max(400),
  description: z.string().max(400).optional(),
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

const QuestionBlockSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const DomainSchema = z.enum([
  "data_foundation",
  "program_readiness",
  "org_reality",
]);

const QuestionSchema = z.object({
  id: z.string().regex(/^q\d+[a-z]?$/i, "Question id must be qN or qNa"),
  block: QuestionBlockSchema,
  domain: DomainSchema,
  text: z.string().min(1).max(2000),
  intent: z.string().max(4000).optional(),
  options: z.array(AnswerOptionSchema).min(2).max(5),
  branch: z
    .object({
      parentQuestionId: z.string(),
      triggerAnswers: z.array(AnswerCodeSchema).min(1),
    })
    .optional(),
});

const TierSchema = z.enum(["Critical", "Emerging", "Developing", "Advanced"]);

const TierBoundarySchema = z.object({
  tier: TierSchema,
  label: z.string().min(1).max(120),
  min: z.number().int().min(0).max(100),
  max: z.number().int().min(0).max(100),
});

const RiskSeveritySchema = z.enum(["critical", "high", "medium"]);

const RiskFlagRuleSchema = z.object({
  code: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  severity: RiskSeveritySchema,
  trigger: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z.union([
          AnswerCodeSchema,
          z.array(AnswerCodeSchema).min(1),
        ]),
      }),
    )
    .min(1),
});

const PriorityTriggerSchema = z.object({
  questionId: z.string(),
  answer: AnswerCodeSchema,
  reason: z.string().min(1).max(1000),
});

const DomainWeightsSchema = z.object({
  data_foundation: z.number().nonnegative(),
  program_readiness: z.number().nonnegative(),
  org_reality: z.number().nonnegative(),
});

export const DiagnosticContentSchema = z.object({
  version: z.string().trim().min(1).max(40),
  questions: z.array(QuestionSchema).min(1),
  riskFlagRules: z.array(RiskFlagRuleSchema),
  priorityTriggers: z.array(PriorityTriggerSchema),
  tierBoundaries: z.array(TierBoundarySchema).min(1),
  domainWeights: DomainWeightsSchema,
});

export type DiagnosticContent = z.infer<typeof DiagnosticContentSchema>;

// ----------------------------------------------------------------------------
// Fallback — deliberately generic. Used when no admin row exists OR
// the row fails to parse. Boots the app without revealing IP:
//   - One placeholder question (the assessment flow expects q1)
//   - No risk flag rules or priority triggers
//   - Real numeric tier boundaries (these are generic readiness bands
//     and not IP-sensitive)
//   - Standard 50/30/20 domain weights (industry-common pattern)
//
// A fresh-clone or wiped DB will run this; the SPA will reset to the
// welcome screen after q1 because q2-q12 don't exist, which is the
// loud "you haven't seeded the admin row yet" signal we want.
// ----------------------------------------------------------------------------

const PLACEHOLDER_OPTIONS: ReadonlyArray<{
  code: "A" | "B" | "C" | "D";
  label: string;
  score: 0 | 1 | 2 | 3;
}> = [
  { code: "A", label: "Placeholder option A (highest)", score: 3 },
  { code: "B", label: "Placeholder option B", score: 2 },
  { code: "C", label: "Placeholder option C", score: 1 },
  { code: "D", label: "Placeholder option D (lowest)", score: 0 },
];

const FALLBACK_QUESTION: Question = {
  id: "q1",
  block: 1,
  domain: "org_reality",
  text:
    "Fallback diagnostic content is active — the real questions live in /admin/diagnostic. Pick any option to dismiss.",
  intent:
    "Placeholder rendered when no admin row for diagnostic_content exists.",
  options: PLACEHOLDER_OPTIONS.map((o) => ({ ...o })),
};

const FALLBACK_TIER_BOUNDARIES: TierBoundary[] = [
  { tier: "Critical", label: "Critical", min: 0, max: 25 },
  { tier: "Emerging", label: "Emerging", min: 26, max: 50 },
  { tier: "Developing", label: "Developing", min: 51, max: 75 },
  { tier: "Advanced", label: "Advanced", min: 76, max: 100 },
];

const FALLBACK_DOMAIN_WEIGHTS: DomainWeights = {
  data_foundation: 0.5,
  program_readiness: 0.3,
  org_reality: 0.2,
};

export const DIAGNOSTIC_CONTENT_FALLBACK: DiagnosticContent = {
  version: "fallback-v0",
  questions: [FALLBACK_QUESTION],
  riskFlagRules: [] as RiskFlagRule[],
  priorityTriggers: [] as PriorityTrigger[],
  tierBoundaries: FALLBACK_TIER_BOUNDARIES,
  domainWeights: FALLBACK_DOMAIN_WEIGHTS,
};
