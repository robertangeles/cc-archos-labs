import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks for the hybrid-recall orchestration (recall.ts). The DB query
// paths (recallFromDb / recallWorkspaceFromDb) are proven against the DEV DB;
// here we test the merge + flag-gating + org-resolution logic.
const m = vi.hoisted(() => ({
  recallFromDb: vi.fn(),
  recallWorkspaceFromDb: vi.fn(),
  isEnabled: vi.fn(),
  getOrgId: vi.fn(),
  resolveOrg: vi.fn(),
}));

vi.mock("./memory", () => ({
  recallFromDb: m.recallFromDb,
  recallWorkspaceFromDb: m.recallWorkspaceFromDb,
}));
vi.mock("./workspace-ingest", () => ({ isWorkspaceMemoryEnabled: m.isEnabled }));
vi.mock("../auth/org-context", () => ({
  getOrgIdFromCookies: m.getOrgId,
  resolveOrgContext: m.resolveOrg,
}));

import { recallMemories, formatRecallContext } from "./recall";

beforeEach(() => {
  m.recallFromDb
    .mockReset()
    .mockResolvedValue({ memories: ["private fact"], source: "brain", count: 1 });
  m.recallWorkspaceFromDb.mockReset().mockResolvedValue(["workspace fact"]);
  m.isEnabled.mockReset().mockReturnValue(false);
  m.getOrgId.mockReset().mockResolvedValue("org-1");
  m.resolveOrg.mockReset().mockResolvedValue({ orgId: "org-1", role: "owner" });
});

describe("recallMemories (hybrid)", () => {
  it("flag off → private tier only, workspace never queried", async () => {
    const r = await recallMemories("user-1", "q");
    expect(r.memories).toEqual(["private fact"]);
    expect(m.recallWorkspaceFromDb).not.toHaveBeenCalled();
  });

  it("flag on → merges private + shared workspace facts", async () => {
    m.isEnabled.mockReturnValue(true);
    const r = await recallMemories("user-1", "q");
    expect(r.memories).toEqual(["private fact", "workspace fact"]);
    expect(r.count).toBe(2);
    expect(r.source).toBe("brain");
    expect(m.recallWorkspaceFromDb).toHaveBeenCalledWith("org-1", "q");
  });

  it("flag on but user has no org → private only", async () => {
    m.isEnabled.mockReturnValue(true);
    m.resolveOrg.mockResolvedValue(null);
    const r = await recallMemories("user-1", "q");
    expect(r.memories).toEqual(["private fact"]);
    expect(m.recallWorkspaceFromDb).not.toHaveBeenCalled();
  });

  it("shared-tier failure is fail-soft → private only, never throws", async () => {
    m.isEnabled.mockReturnValue(true);
    m.getOrgId.mockRejectedValue(new Error("cookies unavailable"));
    const r = await recallMemories("user-1", "q");
    expect(r.memories).toEqual(["private fact"]);
  });

  it("re-validates the org (no raw cookie trust) before querying", async () => {
    m.isEnabled.mockReturnValue(true);
    await recallMemories("user-1", "q");
    // resolveOrgContext re-checks membership, so a tampered cookie can't leak
    // another org's workspace memory.
    expect(m.resolveOrg).toHaveBeenCalledWith("user-1", "org-1");
    expect(m.recallWorkspaceFromDb).toHaveBeenCalledWith("org-1", "q");
  });

  it("returns source 'none' when both tiers are empty", async () => {
    m.recallFromDb.mockResolvedValue({ memories: [], source: "none", count: 0 });
    m.isEnabled.mockReturnValue(true);
    m.recallWorkspaceFromDb.mockResolvedValue([]);
    const r = await recallMemories("user-1", "q");
    expect(r).toEqual({ memories: [], source: "none", count: 0 });
  });
});

describe("formatRecallContext (unchanged)", () => {
  it("strips angle brackets and caps, wraps in a Brain Memory block", () => {
    const out = formatRecallContext(["fact <b>one</b>", "fact two"]);
    expect(out).toContain("## Brain Memory");
    expect(out).toContain("- fact bone/b"); // <> stripped
    expect(out).not.toContain("<");
  });

  it("returns empty string for no memories", () => {
    expect(formatRecallContext([])).toBe("");
  });
});
