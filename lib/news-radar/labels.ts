import "server-only";
import { desc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { newsCandidate, newsCandidateLabel } from "../db/schema";
import type { LabelRequest, RadarLabel } from "./radar-page-types";

// Keep/Skip/clear for one news item. Plan: ceo-plans/2026-10-25-blog-pipeline-
// rebuild-plan.md (ENG-D12 R-labelorder; DES-D6 clear; DES-D7 Use mine).
//
// Labels are append-only. An item's newest row is the one with the highest
// sequence; if that row is a `clear` (or there is none) the item is unlabelled.
// The whole call runs in one transaction that first locks the candidate row, so
// two PATCHes for one item run one after the other and the stale check and the
// insert see the same state.

export type LabelResult =
  | { kind: "ok"; label: RadarLabel | null; latestLabelId: string | null; changed: boolean }
  | { kind: "conflict"; current: RadarLabel | null; latestLabelId: string | null }
  | { kind: "not-found" }
  | { kind: "not-scored" }
  | { kind: "request-id-reused" };

function stateOf(latest: { id: string; decision: string } | undefined) {
  if (!latest) return { label: null, latestLabelId: null };
  return {
    // The decision CHECK constraint limits this to keep, skip or clear.
    label: latest.decision === "clear" ? null : ({ id: latest.id, decision: latest.decision } as RadarLabel),
    latestLabelId: latest.id,
  };
}

export async function applyLabel(
  db: DB,
  candidateId: string,
  input: LabelRequest,
): Promise<LabelResult> {
  return db.transaction(async (tx): Promise<LabelResult> => {
    const [candidate] = await tx
      .select({ id: newsCandidate.id, status: newsCandidate.status })
      .from(newsCandidate)
      .where(eq(newsCandidate.id, candidateId))
      .for("update");
    if (!candidate) return { kind: "not-found" };
    // No cohort until scored, so there is nothing to label against.
    if (candidate.status !== "scored") return { kind: "not-scored" };

    const [latest] = await tx
      .select({ id: newsCandidateLabel.id, decision: newsCandidateLabel.decision })
      .from(newsCandidateLabel)
      .where(eq(newsCandidateLabel.candidateId, candidateId))
      .orderBy(desc(newsCandidateLabel.sequence))
      .limit(1);
    const state = stateOf(latest);

    // Before the stale check: a retry of a request that already landed must
    // return the item's current state, never a conflict.
    const [used] = await tx
      .select({
        candidateId: newsCandidateLabel.candidateId,
        decision: newsCandidateLabel.decision,
      })
      .from(newsCandidateLabel)
      .where(eq(newsCandidateLabel.requestId, input.requestId));
    if (used) {
      return used.candidateId === candidateId && used.decision === input.decision
        ? { kind: "ok", ...state, changed: false }
        : { kind: "request-id-reused" };
    }

    if (input.ifLatestLabelId !== undefined && input.ifLatestLabelId !== state.latestLabelId) {
      return { kind: "conflict", current: state.label, latestLabelId: state.latestLabelId };
    }

    if (input.decision === (state.label?.decision ?? "clear")) {
      return { kind: "ok", ...state, changed: false };
    }

    // The request_id unique violation cannot happen for this item: the lock above
    // serialises its writers and the lookup above already saw any earlier use.
    // The same fresh uuid hitting two items at once is a client bug and surfaces
    // as an unexpected error.
    const [row] = await tx
      .insert(newsCandidateLabel)
      .values({ candidateId, decision: input.decision, requestId: input.requestId })
      .returning({ id: newsCandidateLabel.id });
    return {
      kind: "ok",
      label: input.decision === "clear" ? null : { id: row.id, decision: input.decision },
      latestLabelId: row.id,
      changed: true,
    };
  });
}
