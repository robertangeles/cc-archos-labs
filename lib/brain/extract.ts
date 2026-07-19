import { callMcp } from "./client";
import { getBrainToken } from "./provision";
import { getIntegrationConfig } from "@/lib/integration-config";
import { sanitizeForBrain } from "./sanitize";
import { memoryBackend, captureToDb } from "./memory";

export async function extractMemories(
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  // In-app pgvector backend (cutover flag). Delegates to a local DB insert;
  // the GBrain MCP path below is the legacy default.
  if (memoryBackend() === "pgvector") {
    return captureToDb(userId, userMessage, assistantResponse);
  }

  const config = await getIntegrationConfig();
  if (!config.gbrainUrl) return;

  const token = await getBrainToken(userId);
  if (!token) return;

  const userSanitized = sanitizeForBrain(userMessage);
  const assistantSanitized = sanitizeForBrain(assistantResponse);
  const totalRedacted = userSanitized.redactedCount + assistantSanitized.redactedCount;

  const slug = `sessions/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;
  const content = `---\ntitle: Chat session note\ncreated: ${new Date().toISOString()}\n---\n\n## User\n${userSanitized.sanitized}\n\n## Assistant\n${assistantSanitized.sanitized}`;

  try {
    await callMcp(token, "put_page", { slug, content }, 10000);
    logExtractionOutcome("success", totalRedacted);
  } catch {
    logExtractionOutcome("ingest_error", totalRedacted);
  }
}

type ExtractionOutcome = "success" | "ingest_error";

function logExtractionOutcome(outcome: ExtractionOutcome, redacted = 0): void {
  if (process.env.NODE_ENV === "development") {
    console.log(`[brain:extract] outcome=${outcome} redacted=${redacted}`);
  }
}
