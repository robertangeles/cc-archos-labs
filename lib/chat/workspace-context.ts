import "server-only";
import { getOrgIdFromCookies, resolveOrgContext } from "../auth/org-context";
import { listProjects } from "../projects/service";
import { listClients } from "../clients/service";

// Phase 0 of workspace memory: inject a static snapshot of the user's active-org
// projects and clients into the chat system prompt so Metis grounds responses in
// the workspace without the user pasting context. This is the cheap, spike-free
// first cut — the pgvector workspace_memory tier + agentic traversal come later.
//
//   userId ─▶ resolveOrgContext (validated, no leak) ─▶ listProjects/listClients
//                                                          (org-scoped services)
//                                                          └─▶ formatWorkspaceContext

const MAX_ITEMS = 8;
const MAX_CHARS = 2000;

type ProjectRow = {
  name: string;
  status: string | null;
  clientName: string | null;
};
type ClientRow = { name: string; industry: string | null };

/**
 * Pure formatter — turns workspace rows into a system-prompt context block.
 * Returns "" when there is nothing worth injecting. Archived projects are
 * dropped; lists are capped and the whole block is length-bounded.
 */
export function formatWorkspaceContext(
  projects: ProjectRow[],
  clients: ClientRow[],
): string {
  const lines: string[] = [];

  const activeProjects = projects
    .filter((p) => p.status !== "archived")
    .slice(0, MAX_ITEMS);
  if (activeProjects.length > 0) {
    lines.push("Projects:");
    for (const p of activeProjects) {
      const client = p.clientName ? ` (client: ${p.clientName})` : "";
      const status = p.status ? ` [${p.status}]` : "";
      lines.push(`- ${p.name}${status}${client}`);
    }
  }

  const someClients = clients.slice(0, MAX_ITEMS);
  if (someClients.length > 0) {
    lines.push("Clients:");
    for (const c of someClients) {
      const industry = c.industry ? ` — ${c.industry}` : "";
      lines.push(`- ${c.name}${industry}`);
    }
  }

  if (lines.length === 0) return "";
  const body = lines.join("\n").slice(0, MAX_CHARS);
  return (
    `## Workspace\nThe user's current workspace. Use it to ground responses ` +
    `about their clients and projects when relevant.\n\n${body}\n---\n\n`
  );
}

/**
 * Build the workspace context block for the user's active org. Fail-soft:
 * returns "" on any error (missing org, DB blip) so it never aborts the stream,
 * mirroring how brain/rag context fail soft in stream.ts.
 */
export async function buildWorkspaceContext(userId: string): Promise<string> {
  try {
    const requestedOrgId = await getOrgIdFromCookies();
    const ctx = await resolveOrgContext(userId, requestedOrgId);
    if (!ctx) return "";
    const [projects, clients] = await Promise.all([
      listProjects(ctx.orgId),
      listClients(ctx.orgId),
    ]);
    return formatWorkspaceContext(projects, clients);
  } catch {
    return "";
  }
}
