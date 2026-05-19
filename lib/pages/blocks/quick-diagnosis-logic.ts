// Pure diagnosis logic for the Quick Diagnosis block. Lives in a
// separate module from the React adapter so it's unit-testable without
// pulling in the DOM, and so the same matrix can be reused server-side
// later (e.g. if Phase 3 adds AI authoring that pre-fills the questions
// based on org context).
//
// Precedence:
//   1. Sector-specific governance rules (healthcare, financial) — most
//      specific, win first
//   2. Generic governance + stage rules
//   3. Catch-all (no match in 1 or 2)
//
// Brief: docs/obsession-features-brief.md (May 2026, internal).

export type SectorId =
  | "financial-services"
  | "healthcare"
  | "government"
  | "retail"
  | "other";

export type StageId =
  | "exploring"
  | "pilots"
  | "production-not-scaling"
  | "scaling-with-walls";

export type GovernanceId =
  | "active"
  | "documented"
  | "aspirational"
  | "none";

export interface SectorOption {
  id: SectorId;
  label: string;
}
export interface StageOption {
  id: StageId;
  label: string;
}
export interface GovernanceOption {
  id: GovernanceId;
  label: string;
}

export const SECTORS: readonly SectorOption[] = [
  { id: "financial-services", label: "Financial services" },
  { id: "healthcare", label: "Healthcare and life sciences" },
  { id: "government", label: "Government and public sector" },
  { id: "retail", label: "Retail" },
  { id: "other", label: "Other" },
] as const;

export const STAGES: readonly StageOption[] = [
  { id: "exploring", label: "Still exploring — no firm program yet" },
  {
    id: "pilots",
    label: "We have run pilots but nothing is in production",
  },
  {
    id: "production-not-scaling",
    label: "We have AI in production but it is not scaling",
  },
  {
    id: "scaling-with-walls",
    label: "We are scaling AI but hitting unexpected walls",
  },
] as const;

export const GOVERNANCE: readonly GovernanceOption[] = [
  {
    id: "active",
    label: "Active — it blocks bad decisions and is respected",
  },
  {
    id: "documented",
    label: "Documented — policies exist but are rarely enforced",
  },
  {
    id: "aspirational",
    label: "Aspirational — we have the documents but not the behaviour",
  },
  {
    id: "none",
    label: "We do not have a formal data governance function",
  },
] as const;

export interface DiagnosisInput {
  sector: SectorId;
  stage: StageId;
  governance: GovernanceId;
}

/**
 * Map an answer triple to a single practitioner-voice sentence.
 * Always returns a non-empty string — the catch-all guarantees output
 * for any combination.
 */
export function diagnose({
  sector,
  stage,
  governance,
}: DiagnosisInput): string {
  const govWeak = governance === "aspirational" || governance === "none";
  const earlyStage = stage === "exploring" || stage === "pilots";
  const scalingStage =
    stage === "production-not-scaling" || stage === "scaling-with-walls";

  // --- 1. Sector-specific governance rules (most specific) ---
  if (govWeak && sector === "healthcare") {
    return "In a healthcare context, aspirational governance is not a maturity gap — it is a regulatory exposure. When a model makes an unexpected clinical decision, the question will not be what the model did. It will be who can explain why, and where the data came from.";
  }
  if (govWeak && sector === "financial-services") {
    return "Financial services regulators do not accept aspirational governance as a defence. If your AI program produces a decision that needs explaining, the absence of enforced data governance will be the first thing an auditor finds.";
  }

  // --- 2. Generic governance + stage rules ---
  if (govWeak && earlyStage) {
    return "Your program will not reach production in its current form. Governance without enforcement is not governance — it is a liability waiting to surface in a board presentation.";
  }
  if (governance === "documented" && scalingStage) {
    return "Your program is running on documented governance that nobody enforces. That worked while the program was small. At scale, undocumented exceptions become systemic failures. The walls you are hitting are probably symptoms of this.";
  }
  if (governance === "active" && stage === "scaling-with-walls") {
    return "Your governance is working. The walls you are hitting are likely architectural — data quality degrading at volume, lineage gaps emerging under load, or model performance diverging from pilot conditions. This is solvable but it requires someone who has been here before.";
  }
  if (governance === "active" && earlyStage) {
    return "You have better governance than most organisations at your stage. The risk is building on that foundation before it has been tested under AI workloads specifically. Analytics-ready data is not always AI-ready data.";
  }

  // --- 3. Catch-all ---
  return "The most common failure mode at your stage is not the one you are watching for. Book a call and we will tell you what it is.";
}
