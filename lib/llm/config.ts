import "server-only";
import { getIntegrationConfig } from "../integration-config";

export const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

export const OPENROUTER_HEADERS_STATIC = {
  "Content-Type": "application/json",
  "HTTP-Referer": "https://archoslabs.xyz",
  "X-Title": "Archos Labs",
} as const;

export async function resolveLlmConfig(override?: string): Promise<{
  apiKey: string;
  modelId: string;
}> {
  const config = await getIntegrationConfig();
  if (!config.llmApiKey) {
    throw new Error(
      "LLM API key missing from integration config — run pnpm migrate-integration-secrets or set OPENROUTER_API_KEY in env during the grace window.",
    );
  }
  const modelId = override ?? config.llmModelId;
  if (!modelId) {
    throw new Error(
      "LLM model ID not configured. Set it in /admin/integrations → AI Model → Model ID (e.g. anthropic/claude-sonnet-4-6).",
    );
  }
  return { apiKey: config.llmApiKey, modelId };
}

export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    ...OPENROUTER_HEADERS_STATIC,
    Authorization: `Bearer ${apiKey}`,
  };
}
