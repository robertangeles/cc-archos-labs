import { recallFromDb, recallWorkspaceFromDb } from "./memory";
import { isWorkspaceMemoryEnabled } from "./workspace-ingest";
import { getOrgIdFromCookies, resolveOrgContext } from "../auth/org-context";

export interface RecallResult {
  memories: string[];
  source: "brain" | "none";
  count: number;
}

export async function recallMemories(
  userId: string,
  query: string,
): Promise<RecallResult> {
  const empty: RecallResult = { memories: [], source: "none", count: 0 };

  // Hybrid recall: private per-user facts (user_memory) + org-shared workspace
  // facts (workspace_memory), queried concurrently and merged. Bounded to a
  // recall budget so a hung embed API (embedText retries up to ~90s) can never
  // freeze the reply — recall is awaited before streaming. The loser keeps
  // running (wasted work, not cancelled); the reply proceeds ungrounded.
  const RECALL_BUDGET_MS = 10000;
  const hybrid = async (): Promise<RecallResult> => {
    const [priv, shared] = await Promise.all([
      recallFromDb(userId, query),
      recallSharedTier(userId, query),
    ]);
    const memories = [...priv.memories, ...shared];
    return {
      memories,
      source: memories.length > 0 ? "brain" : "none",
      count: memories.length,
    };
  };

  return Promise.race([
    hybrid(),
    new Promise<RecallResult>((resolve) =>
      setTimeout(() => resolve(empty), RECALL_BUDGET_MS),
    ),
  ]);
}

/**
 * The org-shared tier of hybrid recall: resolve the user's active org and pull
 * its workspace facts. Flag-gated (off → []) and fail-soft. A tampered org
 * cookie is re-validated by resolveOrgContext, so there is no cross-org leak.
 */
async function recallSharedTier(
  userId: string,
  query: string,
): Promise<string[]> {
  if (!isWorkspaceMemoryEnabled()) return [];
  try {
    const requestedOrgId = await getOrgIdFromCookies();
    const ctx = await resolveOrgContext(userId, requestedOrgId);
    if (!ctx) return [];
    return await recallWorkspaceFromDb(ctx.orgId, query);
  } catch {
    return [];
  }
}

const MAX_RECALL_CHARS = 4000;

export function formatRecallContext(memories: string[]): string {
  if (memories.length === 0) return "";

  let total = 0;
  const included: string[] = [];
  for (const m of memories) {
    const escaped = m.replace(/[<>]/g, "").replace(/\n/g, " ").trim();
    if (total + escaped.length > MAX_RECALL_CHARS) break;
    included.push(`- ${escaped}`);
    total += escaped.length;
  }

  if (included.length === 0) return "";

  return `## Brain Memory\nThe following notes were saved from previous sessions with this user. Use them to personalize responses when relevant.\n\n${included.join("\n")}\n---\n\n`;
}
