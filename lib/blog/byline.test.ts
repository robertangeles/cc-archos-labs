import { describe, expect, it } from "vitest";
import { showsDualByline } from "./byline";

// This predicate decides whether the site publicly claims a human reviewed a
// post. Getting it wrong in the permissive direction is not a cosmetic bug —
// it is a false authorship statement in machine-readable form, which is what
// Google's spam policies are about. So the tests lean on the negative cases.

const AGENT_REVIEWED = {
  isAgentGenerated: true,
  reviewedByHumanAt: new Date("2026-07-28T00:00:00Z"),
};

describe("showsDualByline", () => {
  it("shows the dual byline only when the agent wrote it AND a human reviewed it", () => {
    expect(showsDualByline(AGENT_REVIEWED)).toBe(true);
  });

  it("does NOT show it on an unreviewed agent post", () => {
    // The default state of all three posts published every day.
    expect(
      showsDualByline({ isAgentGenerated: true, reviewedByHumanAt: null }),
    ).toBe(false);
  });

  it("does NOT show it on a human-written post, even once reviewed", () => {
    // The 253 WordPress-migrated posts. They carry authorName "Metis" because
    // the site deliberately publishes under a single Metis byline — one author
    // row, renamed to the public byline. That is intended and must not be
    // "fixed". But Metis did not RESEARCH that writing, so "Researched by
    // Metis · Reviewed by Rob" would still be a false claim about it. Hence the
    // gate reads provenance off the post, not off the byline.
    expect(
      showsDualByline({
        isAgentGenerated: false,
        reviewedByHumanAt: new Date("2026-07-28T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("does NOT show it on a human-written, unreviewed post", () => {
    expect(
      showsDualByline({ isAgentGenerated: false, reviewedByHumanAt: null }),
    ).toBe(false);
  });

  it("requires BOTH terms — neither alone is sufficient", () => {
    // Spelled out as a truth table so a future edit that drops one term
    // fails loudly rather than silently widening the claim.
    const cases: Array<[boolean, Date | null, boolean]> = [
      [true, new Date(), true],
      [true, null, false],
      [false, new Date(), false],
      [false, null, false],
    ];
    for (const [isAgentGenerated, reviewedByHumanAt, expected] of cases) {
      expect(showsDualByline({ isAgentGenerated, reviewedByHumanAt })).toBe(
        expected,
      );
    }
  });
});
