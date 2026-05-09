import "server-only";

// Server-only LLM client. Talks to OpenRouter's OpenAI-compatible
// chat-completions endpoint with model id "anthropic/claude-sonnet-4-6".
// OpenRouter proxies requests to Anthropic + handles billing under a
// single key — see https://openrouter.ai/docs.
//
// Lazy validation: throws on first call if OPENROUTER_API_KEY is
// missing, so module import never crashes a build.
//
// Naming kept as `lib/claude.ts` for clarity: every call still goes
// to a Claude model. The transport is OpenRouter, not the Anthropic
// SDK.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// OpenRouter model id format: "<provider>/<model>". The
// claude-sonnet-4-6 mapping is "anthropic/claude-sonnet-4-6" — override
// via CLAUDE_MODEL_ID env var if a different revision is preferred.
export const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4-6";

function getModelId(override?: string): string {
  return override ?? process.env.CLAUDE_MODEL_ID ?? DEFAULT_MODEL_ID;
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local (see .env.example) " +
        "or to the Render service env vars in production.",
    );
  }
  return key;
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
  const apiKey = getApiKey();
  const modelId = getModelId(args.modelId);

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
    const sample = jsonText.slice(0, 200);
    throw new Error(
      `OpenRouter response was not valid JSON (sample: ${sample}…): ${(err as Error).message}`,
    );
  }

  return {
    data,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    modelId,
  };
}
