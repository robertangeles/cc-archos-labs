import "server-only";
import { getIntegrationConfig } from "./integration-config";

// Server-only LLM client. Talks to OpenRouter's OpenAI-compatible
// chat-completions endpoint. The provider-agnostic field names
// (llmApiKey, llmModelId) in integration-config let us swap providers
// later without changing this file's contract.
//
// Naming kept as `lib/claude.ts` for clarity: every call today still
// goes to a Claude model. The transport is OpenRouter, not the
// Anthropic SDK.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Model id resolution: per-call override > admin-configured llmModelId.
// No code-level default — the source of truth is /admin/integrations
// (AI Model section → Model ID). Missing model id surfaces as a clear
// configuration error rather than silently using whatever default the
// source happened to ship with. Anthropic OpenRouter ids look like
// "anthropic/claude-sonnet-4-6" or "anthropic/claude-opus-4-6".

async function resolveLlmConfig(override?: string): Promise<{
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

// ----------------------------------------------------------------------------
// generateStructured — single Claude call returning typed JSON
// ----------------------------------------------------------------------------
//
// The system prompt MUST instruct the model to respond with a JSON
// object of the expected shape and nothing else. This function:
//   1. Issues the chat-completion against OpenRouter
//   2. Extracts the assistant's text content
//   3. Strips any defensive code fences
//   4. Parses as JSON
//   5. Returns parsed value + token usage
//
// On parse failure throws with a sample of the raw text — never silently
// degrade. Callers can render a fallback report or retry.

export interface GenerateStructuredArgs {
  systemPrompt: string;
  userMessage: string;
  /** OpenRouter model id. Defaults to anthropic/claude-sonnet-4-6. */
  modelId?: string;
  /** Hard cap on Claude's response length. */
  maxTokens: number;
}

export interface GenerateStructuredResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
}

interface OpenRouterChatResponse {
  id?: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: { message: string; code?: string };
}

export async function generateStructured<T>(
  args: GenerateStructuredArgs,
): Promise<GenerateStructuredResult<T>> {
  const { apiKey, modelId } = await resolveLlmConfig(args.modelId);

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter analytics — optional but recommended.
      "HTTP-Referer": "https://archoslabs.xyz",
      "X-Title": "Archos Labs",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: args.maxTokens,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as OpenRouterChatResponse;

  if (json.error) {
    throw new Error(`OpenRouter error: ${json.error.message}`);
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }

  // Strip defensive code fences if the model wrapped its JSON. The
  // system prompt forbids them, but a single mis-fence shouldn't
  // crash the report path.
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim()
    : trimmed;

  let data: T;
  try {
    data = JSON.parse(jsonText) as T;
  } catch (err) {
    // Recovery: try extracting a single balanced-brace JSON object.
    // Observed failure modes the strict parse can't survive:
    //   (a) JSON followed by prose ("...} Let me know if you need...")
    //   (b) Two JSON objects with prose between them — Claude self-
    //       corrects ({wrong}\nWait, let me correct:\n{right}).
    //       Take the LAST balanced object — Claude's final answer.
    //   (c) Prose followed by JSON ("Sure, here it is: {...}").
    const candidates = extractBalancedJsonObjects(jsonText);
    let recovered: T | null = null;
    // Try from last to first so Claude's "final corrected" object
    // wins when both exist.
    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        recovered = JSON.parse(candidates[i]) as T;
        break;
      } catch {
        // Try the next candidate.
      }
    }
    if (recovered === null) {
      const sample = jsonText.slice(0, 200);
      throw new Error(
        `OpenRouter response was not valid JSON (sample: ${sample}…): ${(err as Error).message}`,
      );
    }
    data = recovered;
  }

  return {
    data,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    modelId,
  };
}

// Find every balanced-brace JSON-object substring in the input,
// respecting string literals + escape characters. Returns them in
// order of appearance. Used as a fallback when JSON.parse on the
// full response fails because the model wrapped its JSON in prose
// or emitted a self-correcting second object.
//
// Exported for unit testing; production callers should use the
// JSON-then-extract path inside generateStructured above.
export function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    let j = start;
    let closed = false;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(start, j + 1));
          closed = true;
          break;
        }
      }
    }
    // Move past this object (or past the unbalanced opener if we
    // never closed) so the next iteration looks beyond it.
    i = closed ? j + 1 : start + 1;
  }
  return objects;
}
