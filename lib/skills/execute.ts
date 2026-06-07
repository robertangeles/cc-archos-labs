import "server-only";
import { getIntegrationConfig } from "../integration-config";
import type { ExecuteSkillResponse } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const EXECUTE_TIMEOUT_MS = 30_000;

function assemblePrompt(
  template: string,
  inputs: Record<string, string>,
): string {
  let prompt = template;
  for (const [key, value] of Object.entries(inputs)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
}

function sanitizeInput(value: string): string {
   
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export async function executeSkill(opts: {
  promptTemplate: string;
  systemPrompt?: string | null;
  inputs: Record<string, string>;
  model: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<ExecuteSkillResponse> {
  const config = await getIntegrationConfig();
  const apiKey = config.llmApiKey;
  if (!apiKey) {
    throw new ExecuteError(
      "LLM API key not configured. Set OPENROUTER_API_KEY in env or configure via /admin/integrations.",
      502,
    );
  }

  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.inputs)) {
    sanitized[k] = sanitizeInput(v);
  }

  const userContent = assemblePrompt(opts.promptTemplate, sanitized);

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: userContent });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXECUTE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://archoslabs.xyz",
        "X-Title": "Archos Labs Skills Builder",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4000,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ExecuteError(
        "Request timed out. Try a shorter prompt or different model.",
        504,
      );
    }
    throw new ExecuteError("AI service unavailable.", 502);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorMsg = "AI service temporarily unavailable.";
    try {
      const errBody = (await response.json()) as {
        error?: { message?: string };
      };
      if (errBody?.error?.message) {
        errorMsg = errBody.error.message;
      }
    } catch {
      // keep default message
    }

    if (response.status === 429) {
      throw new ExecuteError("Model is busy. Try again in a moment.", 429);
    }
    throw new ExecuteError(errorMsg, response.status >= 500 ? 502 : response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ExecuteError("Invalid model response.", 502);
  }

  const parsed = body as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) {
    throw new ExecuteError("No response from model.", 502);
  }

  return {
    result: content,
    model: opts.model,
    usage: {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
    },
  };
}

export class ExecuteError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ExecuteError";
  }
}
