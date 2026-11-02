// One OpenRouter chat call, with what the drafting pipeline needs:
//
//   - a timeout that fits a real essay (the essay and the photo take 60 to 110 s)
//   - a retry for the failures a retry can fix (429, 5xx, a timeout, a dropped
//     connection) and none for the ones it cannot (400, 401, 402, 404, 422)
//   - an answer that was CUT OFF by its token budget is an error. A model that spends
//     its budget thinking returns a short draft, not a failure, which is how a
//     207-word "essay" nearly got through once
//   - tokens and cost back, so a stage's spend is recorded
//   - the api key is never in an error message
//
// The key comes from an injected function, so this file knows nothing about where
// keys live (the Integrations panel in production).

import { OPENROUTER_URL, buildAuthHeaders } from "../../llm/config";

export interface ChatRequest {
  /** Names the call in logs and step records. Never sent to the provider. */
  label: string;
  model: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Ask for a JSON object. */
  json?: boolean;
}

export interface Citation {
  url: string;
  title?: string;
}

export interface ChatResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** URLs a search model cited, when it gives them. */
  citations: Citation[];
  durationMs: number;
}

export type Llm = (req: ChatRequest) => Promise<ChatResult>;

export type LlmErrorKind = "timeout" | "upstream" | "client" | "truncated" | "bad_response" | "not_configured";

export class LlmError extends Error {
  override name = "LlmError";
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface OpenRouterOptions {
  apiKey: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Waits between tries; injected so tests do not. */
  sleep?: (ms: number) => Promise<void>;
  /** Total tries per call. */
  tries?: number;
}

// A reasoning model spends part of its budget thinking before it writes, and how much varies:
// one real essay used 10,600 tokens, the next ran out of 16,000. The budget is only paid for
// when used. The timeout fits the budget (about 140 tokens a second); three tries of it stay
// inside the 20 minute job lease.
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_TOKENS = 32_000;
const BACKOFF_MS = [2_000, 6_000];
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export function makeOpenRouterLlm(opts: OpenRouterOptions): Llm {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const tries = opts.tries ?? 3;

  return async (req) => {
    const key = await opts.apiKey();
    if (!key) throw new LlmError("LLM API key is not configured (Integrations panel).", "not_configured");

    const started = Date.now();
    const payload = JSON.stringify({
      model: req.model,
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.user }],
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    });

    let last: LlmError | null = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);

      let res: Response;
      try {
        res = await fetchImpl(OPENROUTER_URL, {
          method: "POST",
          headers: buildAuthHeaders(key),
          body: payload,
          signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        last =
          name === "TimeoutError" || name === "AbortError"
            ? new LlmError(`${req.label}: the model did not answer in time`, "timeout")
            : new LlmError(`${req.label}: could not reach the model service`, "upstream");
        continue;
      }

      if (!res.ok) {
        let detail = "";
        try {
          detail = short(((await res.json()) as { error?: { message?: string } })?.error?.message ?? "");
        } catch {
          // no readable body
        }
        // The provider may echo a key it was sent; strip it before anything stores this.
        detail = detail.split(key).join("[key]");
        last = new LlmError(`${req.label}: model service returned ${res.status}${detail ? `: ${detail}` : ""}`, RETRYABLE.has(res.status) ? "upstream" : "client", res.status);
        if (!RETRYABLE.has(res.status)) throw last;
        continue;
      }

      let json: {
        choices?: { message?: { content?: unknown; annotations?: unknown[] }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      try {
        json = await res.json();
      } catch {
        last = new LlmError(`${req.label}: the model service sent something that is not JSON`, "bad_response");
        continue;
      }

      const choice = json.choices?.[0];
      const text = textOf(choice?.message?.content);
      if (choice?.finish_reason === "length") {
        throw new LlmError(`${req.label}: the answer was cut off by the token limit`, "truncated");
      }
      if (text.trim().length === 0) {
        last = new LlmError(`${req.label}: the model returned nothing`, "bad_response");
        continue;
      }

      const citations: Citation[] = [];
      for (const a of choice?.message?.annotations ?? []) {
        const c = (a as { type?: string; url_citation?: { url?: string; title?: string } })?.url_citation;
        if (c?.url) citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}) });
      }
      return {
        text,
        model: req.model,
        inputTokens: json.usage?.prompt_tokens ?? null,
        outputTokens: json.usage?.completion_tokens ?? null,
        costUsd: json.usage?.cost ?? null,
        citations,
        durationMs: Date.now() - started,
      };
    }
    throw last ?? new LlmError(`${req.label}: failed`, "upstream");
  };
}
