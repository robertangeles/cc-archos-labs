import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execTool: vi.fn() }));
vi.mock("../brain/traversal", () => ({
  WORKSPACE_TOOLS: [],
  executeWorkspaceTool: m.execTool,
}));

import { runToolLoop, type ChatMessage, type CallModel } from "./tool-loop";

const CTX = { orgId: "org-1", audience: "internal" as const };
const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

// callModel that returns a queued sequence of assistant messages.
function scripted(responses: ChatMessage[]) {
  const calls: Array<{ offerTools: boolean }> = [];
  let i = 0;
  const fn: CallModel = async (_msgs, offerTools) => {
    calls.push({ offerTools });
    return responses[Math.min(i++, responses.length - 1)];
  };
  return { fn, calls };
}

beforeEach(() => {
  m.execTool.mockReset().mockResolvedValue('{"ok":true}');
});

describe("runToolLoop", () => {
  it("returns immediately when the model makes no tool calls", async () => {
    const { fn, calls } = scripted([{ role: "assistant", content: "hello" }]);
    const r = await runToolLoop([{ role: "user", content: "hi" }], CTX, fn);
    expect(r.finalContent).toBe("hello");
    expect(r.usedTools).toBe(false);
    expect(r.hops).toBe(0);
    expect(m.execTool).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("executes a tool call then returns the final answer", async () => {
    const { fn } = scripted([
      { role: "assistant", tool_calls: [toolCall("t1", "list_projects", {})] },
      { role: "assistant", content: "you have 2 projects" },
    ]);
    const r = await runToolLoop([{ role: "user", content: "?" }], CTX, fn);
    expect(m.execTool).toHaveBeenCalledWith("list_projects", {}, CTX);
    expect(r.usedTools).toBe(true);
    expect(r.finalContent).toBe("you have 2 projects");
    expect(r.messages.some((mm) => mm.role === "tool")).toBe(true);
  });

  it("dedups an identical repeated tool call (executes once)", async () => {
    const { fn } = scripted([
      { role: "assistant", tool_calls: [toolCall("t1", "list_projects", {})] },
      { role: "assistant", tool_calls: [toolCall("t2", "list_projects", {})] },
      { role: "assistant", content: "done" },
    ]);
    const r = await runToolLoop([{ role: "user", content: "x" }], CTX, fn);
    expect(m.execTool).toHaveBeenCalledTimes(1);
    const toolResults = r.messages
      .filter((mm) => mm.role === "tool")
      .map((mm) => String(mm.content));
    expect(toolResults.some((c) => c.includes("duplicate"))).toBe(true);
    expect(r.finalContent).toBe("done");
  });

  it("caps hops and forces a tools-off final answer", async () => {
    let n = 0;
    const fn: CallModel = async (_msgs, offerTools) => {
      if (!offerTools) return { role: "assistant", content: "forced final" };
      return {
        role: "assistant",
        tool_calls: [toolCall(`t${n}`, "search_workspace", { query: `q${n++}` })],
      };
    };
    const r = await runToolLoop([{ role: "user", content: "x" }], CTX, fn);
    expect(r.hops).toBe(5);
    expect(r.finalContent).toBe("forced final");
  });

  it("passes malformed tool-call JSON as {} (never throws)", async () => {
    const badCall = {
      id: "t1",
      type: "function" as const,
      function: { name: "search_workspace", arguments: "{not json" },
    };
    const { fn } = scripted([
      { role: "assistant", tool_calls: [badCall] },
      { role: "assistant", content: "ok" },
    ]);
    const r = await runToolLoop([{ role: "user", content: "x" }], CTX, fn);
    expect(m.execTool).toHaveBeenCalledWith("search_workspace", {}, CTX);
    expect(r.finalContent).toBe("ok");
  });

  it("times out a hung tool and still finishes", async () => {
    vi.useFakeTimers();
    m.execTool.mockReturnValue(new Promise<string>(() => {})); // never resolves
    const { fn } = scripted([
      { role: "assistant", tool_calls: [toolCall("t1", "list_projects", {})] },
      { role: "assistant", content: "done" },
    ]);
    const p = runToolLoop([{ role: "user", content: "x" }], CTX, fn);
    await vi.advanceTimersByTimeAsync(6000); // > PER_TOOL_TIMEOUT_MS (5000)
    const r = await p;
    vi.useRealTimers();
    const toolResult = r.messages.find((mm) => mm.role === "tool");
    expect(String(toolResult?.content)).toContain("timed out");
    expect(r.finalContent).toBe("done");
  });
});
