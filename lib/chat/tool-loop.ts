import "server-only";
import {
  WORKSPACE_TOOLS,
  executeWorkspaceTool,
  type ToolContext,
} from "../brain/traversal";

// The bounded agentic tool loop (SPK-1 decided B). Given the conversation and a
// model-caller, resolve any workspace tool calls the model makes, then return
// the final answer. Per SPK-1, a tool-calling turn carries no user-facing text,
// so this loop runs the intermediate (non-streamed) rounds; the caller delivers
// the final answer.
//
// Guardrails (all non-negotiable, from the spike):
//   - hop cap: at most MAX_HOPS model round-trips
//   - per-tool timeout: a hung tool can't stall the turn
//   - dedup guard: the model repeating an identical tool call is not re-run
//   - wall-clock budget: the whole loop is time-boxed
//   - forced finish: when the cap/budget is hit mid-tool-use, one final call
//     WITHOUT tools forces an answer (never leaves the user hanging)

const MAX_HOPS = 5;
const PER_TOOL_TIMEOUT_MS = 5000;
const WALL_CLOCK_MS = 20000;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// The model caller: given the conversation and whether to offer tools, return
// the assistant message (which may contain tool_calls). Injected so the loop is
// testable and provider-agnostic.
export type CallModel = (
  messages: ChatMessage[],
  offerTools: boolean,
) => Promise<ChatMessage>;

export interface ToolLoopResult {
  messages: ChatMessage[]; // conversation incl. the assistant + tool turns
  finalContent: string; // the final assistant answer (may be "")
  hops: number;
  usedTools: boolean;
}

export async function runToolLoop(
  messages: ChatMessage[],
  ctx: ToolContext,
  callModel: CallModel,
): Promise<ToolLoopResult> {
  const convo = [...messages];
  const start = Date.now();
  const seen = new Set<string>();
  let usedTools = false;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const overBudget = Date.now() - start > WALL_CLOCK_MS;
    const assistant = await callModel(convo, !overBudget);
    convo.push(assistant);

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0 || overBudget) {
      // A normal answer (no tool calls), or we're out of budget — done.
      return {
        messages: convo,
        finalContent: assistant.content ?? "",
        hops: hop,
        usedTools,
      };
    }

    usedTools = true;
    for (const call of calls) {
      const key = `${call.function.name}:${call.function.arguments}`;
      let result: string;
      if (seen.has(key)) {
        // Dedup guard — the model repeated an identical call.
        result = JSON.stringify({ error: "duplicate tool call skipped" });
      } else {
        seen.add(key);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // Malformed args from the model — pass {} and let the tool validate.
        }
        result = await withTimeout(
          executeWorkspaceTool(call.function.name, args, ctx),
          PER_TOOL_TIMEOUT_MS,
        );
      }
      convo.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // Hit the hop cap with tools still in play — force an answer WITHOUT tools.
  const final = await callModel(convo, false);
  convo.push(final);
  return {
    messages: convo,
    finalContent: final.content ?? "",
    hops: MAX_HOPS,
    usedTools,
  };
}

function withTimeout(p: Promise<string>, ms: number): Promise<string> {
  return Promise.race([
    p,
    new Promise<string>((resolve) =>
      setTimeout(
        () => resolve(JSON.stringify({ error: "tool timed out" })),
        ms,
      ),
    ),
  ]);
}

export { WORKSPACE_TOOLS };
