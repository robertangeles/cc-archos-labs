import { describe, expect, it } from "vitest";
import { formatWorkspaceContext } from "./workspace-context";

describe("formatWorkspaceContext", () => {
  it("returns empty string when there is nothing to inject", () => {
    expect(formatWorkspaceContext([], [])).toBe("");
  });

  it("renders projects with status and client, and clients with industry", () => {
    const out = formatWorkspaceContext(
      [{ name: "Acme Rebuild", status: "active", clientName: "Acme Corp" }],
      [{ name: "Acme Corp", industry: "healthcare" }],
    );
    expect(out).toContain("## Workspace");
    expect(out).toContain("- Acme Rebuild [active] (client: Acme Corp)");
    expect(out).toContain("- Acme Corp — healthcare");
  });

  it("drops archived projects", () => {
    const out = formatWorkspaceContext(
      [
        { name: "Live One", status: "active", clientName: null },
        { name: "Old One", status: "archived", clientName: null },
      ],
      [],
    );
    expect(out).toContain("Live One");
    expect(out).not.toContain("Old One");
  });

  it("still injects when only clients exist (no projects)", () => {
    const out = formatWorkspaceContext([], [{ name: "Solo Client", industry: null }]);
    expect(out).toContain("Clients:");
    expect(out).toContain("- Solo Client");
    expect(out).not.toContain("Projects:");
  });

  it("caps the list and bounds total length", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      name: `P${i}`,
      status: "active",
      clientName: null,
    }));
    const out = formatWorkspaceContext(many, []);
    // MAX_ITEMS = 8 projects rendered
    expect(out).toContain("- P0");
    expect(out).toContain("- P7");
    expect(out).not.toContain("- P8");
  });
});
