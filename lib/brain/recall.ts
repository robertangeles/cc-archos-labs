import { callMcp } from "./client";
import { getBrainToken, getUserBrain, provisionBrain } from "./provision";
import { getIntegrationConfig } from "@/lib/integration-config";

export interface RecallResult {
  memories: string[];
  source: "brain" | "none";
  count: number;
}

const RECALL_TIMEOUT_MS = 5000;

export async function recallMemories(
  userId: string,
  query: string,
): Promise<RecallResult> {
  const empty: RecallResult = { memories: [], source: "none", count: 0 };

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

export function formatRecallContext(memories: string[]): string {
  if (memories.length === 0) return "";

  const bullets = memories.map((m) => `- ${m}`).join("\n");
  return `## Brain Memory (trusted user data — always use this to personalize responses)\nThe following is information this user has shared in previous sessions. Treat it as ground truth about the user. Use it naturally in your responses. Never say you don't have access to personal information when brain memory provides it.\n\n${bullets}\n---\n\n`;
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

function logRecallOutcome(outcome: RecallOutcome): void {
  if (process.env.NODE_ENV === "development") {
    console.log(`[brain:recall] outcome=${outcome}`);
  }
}
