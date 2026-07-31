import "server-only";
import { OPENROUTER_URL, buildAuthHeaders } from "../llm/config";
import { getOrgIdFromCookies, resolveOrgContext } from "../auth/org-context";
import { toolsFor } from "../brain/traversal";
import {
  runToolLoop,
  type ChatMessage,
  type CallModel,
  type OnProgress,
} from "./tool-loop";

// C2 stream integration helpers. Flag-gated + org-scoped: when enabled and the
// user has an org, the chat model can call allowlisted workspace tools to reason
// over the workspace (SPK-1 decided the agentic-loop path). A tool-using turn's
// final answer is produced non-streamed, so the caller delivers it as a single
// chunk (like the web-search path).

export function isWorkspaceToolsEnabled(): boolean {
  return process.env.WORKSPACE_TOOLS_ENABLED === "true";
}

/**
 * Resolve the user's active org, re-validating membership (a tampered cookie
 * can't select another org). null when the user has no org.
 */
export async function resolveToolOrgId(userId: string): Promise<string | null> {
  try {
    const requested = await getOrgIdFromCookies();
    const ctx = await resolveOrgContext(userId, requested);
    return ctx?.orgId ?? null;
  } catch {
    return null;
  }
}

/**
 * The OpenRouter (non-streaming) model caller the loop drives. Offers the
 * workspace tools only when `offerTools` (the loop turns them off to force a
 * final answer at the hop cap). Returns the assistant message (may carry
 * tool_calls). Throws on a non-OK response — the caller falls back to normal
 * streaming.
 */
export function buildCallModel(
  modelId: string,
  apiKey: string,
  orgId: string | null,
  signal?: AbortSignal,
): CallModel {
  // PER-TOOL gating. The loop used to be skipped entirely when the user had no
  // org, which silently disabled the one capability it was turned on for —
  // search_library reads a shared shelf with no tenant data, so the org guard
  // that protects the other four has nothing to protect there.
  const tools = toolsFor(orgId);
  return async (messages, offerTools) => {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        stream: false,
        messages,
        ...(offerTools ? { tools } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const j = await res.json();
    const msg = j.choices?.[0]?.message ?? {};
    return {
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    } as ChatMessage;
  };
}

/**
 * Run the workspace tool loop for one turn and return the final answer text.
 * Returns "" if the loop produced no answer (caller then falls back to normal
 * streaming, ungrounded).
 */
export async function runWorkspaceToolTurn(args: {
  messages: ChatMessage[];
  orgId: string | null;
  audience: "internal" | "client";
  seenChunkIds?: Set<string>;
  modelId: string;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: OnProgress;
}): Promise<string> {
  const result = await runToolLoop(
    args.messages,
    {
      orgId: args.orgId,
      audience: args.audience,
      seenChunkIds: args.seenChunkIds,
    },
    buildCallModel(args.modelId, args.apiKey, args.orgId, args.signal),
    args.onProgress,
  );
  return result.finalContent;
}
