import "server-only";
import { listProjects } from "../projects/service";
import { listClients } from "../clients/service";
import { getBoard } from "../kanban/service";
import { recallWorkspaceFromDb } from "./memory";

// C2 traversal tools — the allowlist the chat model can call to reason over the
// workspace (SPK-1 decided the agentic-loop path). SECURITY SPINE: the model
// supplies only query/id args; the SERVER injects the validated orgId
// (ctx.orgId) at execution. Every tool wraps an existing org-scoped service, so
// the model can never reach another org or run raw SQL. Results are bounded and
// bad args fail safe (no existence oracle: out-of-org ids resolve to
// "not found", never a permission error).

export interface ToolContext {
  orgId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULT_CHARS = 4000;

function json(o: unknown): string {
  return JSON.stringify(o).slice(0, MAX_RESULT_CHARS);
}

// OpenAI/OpenRouter-style tool definitions the model sees. No orgId here — the
// model must not (and cannot) supply it.
export const WORKSPACE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_workspace",
      description:
        "Semantic search over the user's remembered workspace facts " +
        "(projects, clients, cards). Use for open-ended questions about " +
        "their book of work.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description:
        "List the user's projects with id, status, and client. Use to find " +
        "a project's id before drilling into its cards.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_clients",
      description: "List the user's clients with id and industry.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project_cards",
      description:
        "List the kanban cards in a project (title, column, priority). " +
        "Requires a project_id from list_projects.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project's id" },
        },
        required: ["project_id"],
      },
    },
  },
];

/**
 * Execute one tool call. Returns a JSON string (the tool-result content the
 * model sees). Always org-scoped via ctx.orgId; unknown tools, bad args, and
 * failures all return a safe JSON error rather than throwing.
 */
export async function executeWorkspaceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "search_workspace": {
        const query = String(args.query ?? "").slice(0, 500);
        if (!query) return json({ error: "query required" });
        const facts = await recallWorkspaceFromDb(ctx.orgId, query);
        return json({ facts });
      }
      case "list_projects": {
        const rows = await listProjects(ctx.orgId);
        return json({
          projects: rows.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            client: p.clientName,
          })),
        });
      }
      case "list_clients": {
        const rows = await listClients(ctx.orgId);
        return json({
          clients: rows.map((c) => ({
            id: c.id,
            name: c.name,
            industry: c.industry,
          })),
        });
      }
      case "get_project_cards": {
        const projectId = String(args.project_id ?? "");
        if (!UUID_RE.test(projectId)) {
          return json({ error: "valid project_id required" });
        }
        // getBoard returns null when the project is not in ctx.orgId — the IDOR
        // guard. Report "not found", never "forbidden" (no existence oracle).
        // It returns columns with their cards nested.
        const board = await getBoard(ctx.orgId, projectId);
        if (!board) return json({ error: "project not found" });
        const cards = board.flatMap((col) =>
          col.cards.map((c) => ({
            title: c.title,
            column: col.name,
            priority: c.priority,
          })),
        );
        return json({ cards });
      }
      default:
        return json({ error: `unknown tool: ${name}` });
    }
  } catch {
    return json({ error: "tool failed" });
  }
}
