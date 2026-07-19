import { callMcp } from "./client";
import { getBrainToken, getUserBrain, provisionBrain } from "./provision";
import { getIntegrationConfig } from "@/lib/integration-config";
import { memoryBackend, recallFromDb } from "./memory";

export interface RecallResult {
  memories: string[];
  source: "brain" | "none";
  count: number;
}

// 10s (was 5s): the GBrain vector query runs ~1.5s warm but 5s+ on a
// cold/just-woken Render instance, which silently blew the old 5s budget
// and returned no memories. Recall is awaited before the reply streams, so
// this is also the ceiling on first-message latency after idle; the
// /api/brain/warm ping on workspace open keeps the common case fast.
const RECALL_TIMEOUT_MS = 10000;

export async function recallMemories(
  userId: string,
  query: string,
): Promise<RecallResult> {
  const empty: RecallResult = { memories: [], source: "none", count: 0 };

  // In-app pgvector backend (cutover flag). Delegates to a local DB scan,
  // bounded to a recall budget so a hung embed API (embedText retries up to
  // ~90s) can never freeze the reply — recall is awaited before streaming.
  // Parity with the GBrain path's 10s ceiling; the loser keeps running
  // (wasted work, not cancelled) but the reply proceeds ungrounded.
  if (memoryBackend() === "pgvector") {
    const RECALL_BUDGET_MS = 10000;
    return Promise.race([
      recallFromDb(userId, query),
      new Promise<RecallResult>((resolve) =>
        setTimeout(() => resolve(empty), RECALL_BUDGET_MS),
      ),
    ]);
  }

  const config = await getIntegrationConfig();
  if (!config.gbrainUrl || !config.gbrainAdminToken) {
    return empty;
  }

  let token: string | null;
  try {
    const brain = await getUserBrain(userId);
    if (!brain) {
      provisionBrain(userId).catch(() => {});
      return empty;
    }
    token = await getBrainToken(userId);
  } catch {
    logRecallOutcome("error");
    return empty;
  }

  if (!token) {
    logRecallOutcome("no_brain");
    return empty;
  }

  try {
    const response = await callMcp(
      token,
      "query",
      { query, limit: 5 },
      RECALL_TIMEOUT_MS,
    );

    if (response.error) {
      logRecallOutcome("error");
      return empty;
    }

    const pages = extractPages(response.result);
    if (pages.length === 0) {
      logRecallOutcome("empty");
      return empty;
    }

    logRecallOutcome("success");
    return { memories: pages, source: "brain", count: pages.length };
  } catch {
    logRecallOutcome("timeout");
    return empty;
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

function extractPages(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];

  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        const text = (item as { text: string }).text;
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            return parsed
              .filter((p: unknown) =>
                typeof p === "object" && p !== null && "chunk_text" in p
              )
              .map((p: unknown) => (p as { chunk_text: string }).chunk_text)
              .filter((t) => t.length > 0);
          }
        } catch {
          if (text.length > 0) return [text];
        }
      }
    }
  }

  return [];
}

type RecallOutcome = "success" | "timeout" | "error" | "empty" | "no_brain";

// Log the outcome (never the query or memory content — privacy first).
// Failures are logged in every environment so a silently-degraded brain is
// visible in prod logs; success/empty stay dev-only to avoid log noise.
function logRecallOutcome(outcome: RecallOutcome): void {
  const isFailure = outcome === "timeout" || outcome === "error";
  if (isFailure || process.env.NODE_ENV === "development") {
    console.log(`[brain:recall] outcome=${outcome}`);
  }
}
