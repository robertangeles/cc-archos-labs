import "server-only";
import { listProjects } from "../projects/service";
import { listClients } from "../clients/service";
import { getBoard } from "../kanban/service";
import { recallWorkspaceFromDb } from "./memory";
import { searchLibraryChunks } from "../knowledge/search";

// C2 traversal tools — the allowlist the chat model can call mid-answer.
//
// SECURITY SPINE: the model supplies only query/id args; the SERVER injects the
// validated orgId at execution. The model can never reach another org or run
// raw SQL. Results are bounded and bad args fail safe (no existence oracle:
// out-of-org ids resolve to "not found", never a permission error).
//
// NOT every tool is org-scoped any more. search_library reads a shared shelf of
// books with no tenant data in it, so it is offered whether or not the user has
// an org — see toolsFor(). The other four hard-fail on a null orgId rather than
// querying with one.

export interface ToolContext {
  /** null when the user has no org. The four workspace tools are then not
   *  offered at all; search_library still is, because the book library is a
   *  shared shelf with no tenant data in it. */
  orgId: string | null;
  /** Governs whether tool results may carry document titles. A client turn
   *  gets content only — the same rule the pre-turn excerpts follow, applied
   *  here because tool results reach the model through a different door. */
  audience: "internal" | "client";
  /** chunkIds already injected by this turn's pre-turn retrieval. The model
   *  seeing the same passage twice over-weights it. */
  seenChunkIds?: Set<string>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULT_CHARS = 4000;

function json(o: unknown): string {
  return JSON.stringify(o).slice(0, MAX_RESULT_CHARS);
}

// search_library returns PROSE, not the short structured lists the other tools
// return. A book chunk is ~1000 tokens, so 4000 chars is roughly one chunk —
// and json()'s blunt .slice() would cut the second one mid-word, every time.
// This budget drops whole chunks instead, so the model never sees a truncated
// sentence and mistake it for the end of a thought.
const LIBRARY_RESULT_CHARS = 9000;

// search_library must NOT go through json(). That helper ends with
// .slice(0, 4000), which would cut the packed payload mid-string and hand the
// model unparseable JSON — defeating the whole point of packing whole chunks.
// The packing already bounds the size; a second blunt cut on top only breaks it.
function jsonLibrary(o: unknown): string {
  return JSON.stringify(o);
}

function packChunks(
  chunks: Array<{ title: string; content: string }>,
  audience: "internal" | "client",
): { excerpts: unknown[]; omitted: number } {
  const excerpts: unknown[] = [];
  let used = 0;
  for (const c of chunks) {
    // Client turns get content with NO title. Same rule as the pre-turn
    // excerpts: the instruction not to name a source is a rule the model
    // follows, withholding the title is a fact it cannot reason around.
    //
    // A single chunk larger than the whole budget is truncated at a word
    // boundary rather than dropped — returning nothing would be worse — but
    // only ever as the first item, so it can never sever a later one.
    const content =
      excerpts.length === 0 && c.content.length > LIBRARY_RESULT_CHARS
        ? c.content.slice(0, c.content.lastIndexOf(" ", LIBRARY_RESULT_CHARS))
        : c.content;
    const item =
      audience === "internal" ? { work: c.title, excerpt: content } : { excerpt: content };
    const cost = JSON.stringify(item).length;
    if (used + cost > LIBRARY_RESULT_CHARS && excerpts.length > 0) break;
    excerpts.push(item);
    used += cost;
  }
  return { excerpts, omitted: chunks.length - excerpts.length };
}

// OpenAI/OpenRouter-style tool definitions the model sees. No orgId here — the
// model must not (and cannot) supply it.
// The library search. Offered on every tool-enabled turn, org or not — it
// reads a shared shelf that contains no tenant data, so the org guard that
// protects the other four has nothing to protect here. Gating it on org
// membership (which is what inheriting the loop's guard did) meant the one
// capability the tool loop was turned on for silently never fired for a user
// without an org.
const SEARCH_LIBRARY_TOOL = {
  type: "function" as const,
  function: {
    name: "search_library",
    description:
      "Search the practice library of consulting, data-management and " +
      "engineering works for material on a specific idea. Use this when you " +
      "want to check what the literature says about a particular angle you " +
      "have opened mid-answer, beyond what you were already given. Search for " +
      "ONE idea at a time; call it again for a different angle.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The idea to look up, as a self-contained phrase. Not the user's " +
            "whole question — the specific thing you want material on.",
        },
      },
      required: ["query"],
    },
  },
};

const ORG_SCOPED_TOOLS = [
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
 * The tools offered for this turn. PER-TOOL gating, not per-loop: the library
 * is always available, the org-scoped four only when an org resolved.
 */
export function toolsFor(orgId: string | null) {
  return orgId ? [SEARCH_LIBRARY_TOOL, ...ORG_SCOPED_TOOLS] : [SEARCH_LIBRARY_TOOL];
}

/** Kept for callers that want the full set (tests, docs). */
export const WORKSPACE_TOOLS = [SEARCH_LIBRARY_TOOL, ...ORG_SCOPED_TOOLS];

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
      case "search_library": {
        const query = String(args.query ?? "").slice(0, 500);
        if (!query) return json({ error: "query required" });

        const rows = await searchLibraryChunks(query);
        // Drop anything the pre-turn retrieval already put in front of the
        // model. Seeing a passage twice reads as two independent sources
        // agreeing, which is exactly the wrong inference.
        const fresh = ctx.seenChunkIds
          ? rows.filter((r) => !ctx.seenChunkIds!.has(r.chunkId))
          : rows;
        const dropped = rows.length - fresh.length;

        if (fresh.length === 0) {
          return jsonLibrary({
            excerpts: [],
            note:
              dropped > 0
                ? "Nothing new — everything found was already provided above."
                : "The library has nothing on that.",
          });
        }
        const { excerpts, omitted } = packChunks(fresh, ctx.audience);
        return jsonLibrary({ excerpts, alreadySeen: dropped, omittedForLength: omitted });
      }
      case "search_workspace": {
        if (!ctx.orgId) return json({ error: "no workspace available" });
        const query = String(args.query ?? "").slice(0, 500);
        if (!query) return json({ error: "query required" });
        const facts = await recallWorkspaceFromDb(ctx.orgId, query);
        return json({ facts });
      }
      case "list_projects": {
        if (!ctx.orgId) return json({ error: "no workspace available" });
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
        if (!ctx.orgId) return json({ error: "no workspace available" });
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
        if (!ctx.orgId) return json({ error: "no workspace available" });
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
