import { recallFromDb } from "./memory";

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

  // Bounded to a recall budget so a hung embed API (embedText retries up to
  // ~90s) can never freeze the reply — recall is awaited before streaming.
  // The loser keeps running (wasted work, not cancelled); the reply proceeds
  // ungrounded rather than blocking.
  const RECALL_BUDGET_MS = 10000;
  return Promise.race([
    recallFromDb(userId, query),
    new Promise<RecallResult>((resolve) =>
      setTimeout(() => resolve(empty), RECALL_BUDGET_MS),
    ),
  ]);
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
