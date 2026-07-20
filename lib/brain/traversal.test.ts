import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listClients: vi.fn(),
  getBoard: vi.fn(),
  recallWorkspaceFromDb: vi.fn(),
}));

vi.mock("../projects/service", () => ({ listProjects: m.listProjects }));
vi.mock("../clients/service", () => ({ listClients: m.listClients }));
vi.mock("../kanban/service", () => ({ getBoard: m.getBoard }));
vi.mock("./memory", () => ({ recallWorkspaceFromDb: m.recallWorkspaceFromDb }));

import { executeWorkspaceTool, WORKSPACE_TOOLS } from "./traversal";

const CTX = { orgId: "org-1" };
const PID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  m.listProjects.mockReset().mockResolvedValue([
    { id: PID, name: "Acme Rebuild", status: "active", clientName: "Acme" },
  ]);
  m.listClients
    .mockReset()
    .mockResolvedValue([{ id: "c1", name: "Acme", industry: "healthcare" }]);
  // getBoard returns columns with their cards nested (Column[]).
  m.getBoard.mockReset().mockResolvedValue([
    {
      id: "col1",
      name: "In Progress",
      cards: [{ title: "Ship it", columnId: "col1", priority: "high" }],
    },
  ]);
  m.recallWorkspaceFromDb.mockReset().mockResolvedValue(["Acme is active"]);
});

const parse = (s: string) => JSON.parse(s);

describe("WORKSPACE_TOOLS definitions", () => {
  it("expose no orgId parameter (server injects it)", () => {
    const params = WORKSPACE_TOOLS.map((t) =>
      JSON.stringify(t.function.parameters),
    ).join(" ");
    expect(params).not.toContain("orgId");
    expect(params).not.toContain("organisation");
  });
});

describe("executeWorkspaceTool — org scoping", () => {
  it("search_workspace queries with the injected orgId only", async () => {
    const out = parse(
      await executeWorkspaceTool("search_workspace", { query: "acme" }, CTX),
    );
    expect(m.recallWorkspaceFromDb).toHaveBeenCalledWith("org-1", "acme");
    expect(out.facts).toEqual(["Acme is active"]);
  });

  it("list_projects scopes to ctx.orgId and maps id/name/status/client", async () => {
    const out = parse(await executeWorkspaceTool("list_projects", {}, CTX));
    expect(m.listProjects).toHaveBeenCalledWith("org-1");
    expect(out.projects[0]).toEqual({
      id: PID,
      name: "Acme Rebuild",
      status: "active",
      client: "Acme",
    });
  });

  it("get_project_cards scopes getBoard to ctx.orgId + the project id", async () => {
    const out = parse(
      await executeWorkspaceTool("get_project_cards", { project_id: PID }, CTX),
    );
    expect(m.getBoard).toHaveBeenCalledWith("org-1", PID);
    expect(out.cards[0]).toEqual({
      title: "Ship it",
      column: "In Progress",
      priority: "high",
    });
  });
});

describe("executeWorkspaceTool — safety", () => {
  it("unknown tool returns a safe error", async () => {
    const out = parse(await executeWorkspaceTool("drop_tables", {}, CTX));
    expect(out.error).toContain("unknown tool");
  });

  it("get_project_cards rejects a non-uuid project_id (no DB call)", async () => {
    const out = parse(
      await executeWorkspaceTool(
        "get_project_cards",
        { project_id: "'; DROP TABLE--" },
        CTX,
      ),
    );
    expect(out.error).toContain("project_id");
    expect(m.getBoard).not.toHaveBeenCalled();
  });

  it("out-of-org project (getBoard null) → 'not found', not a permission leak", async () => {
    m.getBoard.mockResolvedValue(null);
    const out = parse(
      await executeWorkspaceTool("get_project_cards", { project_id: PID }, CTX),
    );
    expect(out.error).toBe("project not found");
  });

  it("search_workspace requires a query", async () => {
    const out = parse(await executeWorkspaceTool("search_workspace", {}, CTX));
    expect(out.error).toContain("query");
  });

  it("a failing service returns a safe error, never throws", async () => {
    m.listProjects.mockRejectedValue(new Error("db down"));
    const out = parse(await executeWorkspaceTool("list_projects", {}, CTX));
    expect(out.error).toBe("tool failed");
  });
});
