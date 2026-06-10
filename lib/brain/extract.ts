import { callMcp } from "./client";
import { getBrainToken } from "./provision";
import { getIntegrationConfig } from "@/lib/integration-config";

export async function extractMemories(
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const config = await getIntegrationConfig();
  if (!config.gbrainUrl) return;

  const token = await getBrainToken(userId);
  if (!token) return;

  const slug = `sessions/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;
  const content = `---\ntitle: Chat session note\ncreated: ${new Date().toISOString()}\n---\n\n## User\n${userMessage}\n\n## Assistant\n${assistantResponse}`;

  try {
    await callMcp(token, "put_page", { slug, content }, 10000);
    logExtractionOutcome("success");
  } catch {
    logExtractionOutcome("ingest_error");
  }
}

type ExtractionOutcome = "success" | "ingest_error";

function logExtractionOutcome(outcome: ExtractionOutcome): void {
  if (process.env.NODE_ENV === "development") {
    console.log(`[brain:extract] outcome=${outcome}`);
  }
}
