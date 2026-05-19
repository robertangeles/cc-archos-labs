// claude-polish.ts — Claude generates editorial polish per post.
//
// One call per post via OpenRouter (anthropic/claude-sonnet-4-6). Returns
// a typed JSON object:
//   - excerpt          1-2 sentences, replacement for WP excerpt
//   - topicTags        3-7 tags drawn from a fixed taxonomy + free-form
//   - currencyConcerns array of "this is dated because X" strings
//   - needsReview      boolean: human should sanity-check before publish
//
// Cost discipline: prompt is ~600 tokens, response ~300 tokens. 253 posts
// = ~$0.80 total at Sonnet 4.6 pricing on OpenRouter. We don't use
// caching because OpenRouter's cache-control passthrough is unreliable;
// switching to direct Anthropic SDK would unlock it but isn't worth the
// extra vendor at this scale.
//
// Error handling: retries up to 3 times on transient failures (5xx,
// network, malformed JSON). On final failure, returns a default with
// needsReview=true and the error in currencyConcerns so the manifest
// captures it. Never throws — the orchestrator continues with other posts.

import type { PolishedPost, TransformedPost } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_ID = "anthropic/claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an editorial assistant for The Translation Layer, the blog at archoslabs.xyz/blog. The brand is Archos Labs — a practitioner-led AI transformation studio for enterprise programs in financial services, healthcare, and government.

Voice: direct, honest, no corporate speak, no vanity metrics, no hedging. Sentences are short. Verbs are active. Concrete nouns. Senior executives are the audience.

You are migrating a post from a WordPress source. Read the post and return a JSON object with EXACTLY these fields:

{
  "excerpt": "string — 1-2 sentences (max 220 chars) summarising the post for the /blog index card and og:description. Match the voice above. Don't include the title verbatim. Don't start with 'This post' or 'In this article'.",
  "topicTags": ["string", ...] — 3 to 7 topic tag slugs (kebab-case, lowercase) drawn from the post's content. Examples of good tags: 'ai-governance', 'data-lineage', 'enterprise-ai', 'risk-management'. Reuse a focus-keyphrase seed if provided. Avoid generic tags like 'business' or 'technology'.",
  "currencyConcerns": ["string", ...] — array of CONCRETE concerns about content currency. Examples: 'References Claude 3 Opus (retired)', 'Predates EU AI Act enforcement (Feb 2026)', 'Cites GPT-4 as state of the art'. Empty array if no concerns.",
  "needsReview": boolean — set TRUE if currencyConcerns is non-empty, OR if the post body is unusually short (under 300 words), OR if the post relies on a specific vendor product/feature that may have changed.
}

Return ONLY the JSON object. No prose, no markdown fences, no preamble.`;

// =============================================================================
// Public API
// =============================================================================

export interface PolishOptions {
  /** OpenRouter API key. Reads from env if omitted. */
  apiKey?: string;
  /** Override model id. Defaults to anthropic/claude-sonnet-4-6. */
  modelId?: string;
  /** Tag-frequency map from extract.fetchTagFrequencies — used to filter
   *  Claude's tag suggestions to keep tags that exist in the WP corpus
   *  with count >= 2 (per Phase A4 decision). */
  tagAllowlist?: Map<string, number>;
}

export async function polishPost(
  post: TransformedPost,
  opts: PolishOptions = {},
): Promise<PolishedPost> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return failureFallback(
      post,
      "OPENROUTER_API_KEY is not set — polish stage skipped",
    );
  }
  const modelId = opts.modelId ?? MODEL_ID;

  const userMessage = buildUserMessage(post);
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const polished = await callOpenRouter({
        apiKey,
        modelId,
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
      });
      return assemblePolished(post, polished, opts.tagAllowlist);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        await sleep(500 * attempt); // 500ms, 1000ms backoff
      }
    }
  }
  return failureFallback(post, `Claude polish failed after 3 attempts: ${lastError}`);
}

// =============================================================================
// Prompt assembly
// =============================================================================

function buildUserMessage(post: TransformedPost): string {
  const keyphraseLine = post.yoastFocusKeyphrase
    ? `\n\nYoast focus keyphrase (use as a seed for topicTags): "${post.yoastFocusKeyphrase}"`
    : "";
  // Truncate very long content to keep request size sane — first 6000 chars
  // captures the lead + first few sections, which is what the excerpt should
  // reflect anyway.
  const bodySample = post.contentMd.slice(0, 6000);
  return `Title: ${post.title}
Category: ${post.category.name}
Published: ${post.publishedAt.toISOString().slice(0, 10)}${keyphraseLine}

Post body (truncated to first 6000 chars if longer):
---
${bodySample}
---

Return the JSON object as specified in the system prompt.`;
}

// =============================================================================
// OpenRouter call
// =============================================================================

interface RawClaudeResponse {
  excerpt: string;
  topicTags: string[];
  currencyConcerns: string[];
  needsReview: boolean;
}

interface OpenRouterChatResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  error?: { message: string; code?: string };
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function callOpenRouter(args: {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  userMessage: string;
}): Promise<RawClaudeResponse> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://archoslabs.xyz",
      "X-Title": "Archos Labs migrate-wp",
    },
    body: JSON.stringify({
      model: args.modelId,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userMessage },
      ],
      max_tokens: 800,
      temperature: 0.2, // editorial polish is reproducible; low temperature
    }),
    // 60-second timeout — Claude can be slow.
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as OpenRouterChatResponse;
  if (json.error) throw new Error(`OpenRouter API error: ${json.error.message}`);
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`OpenRouter response missing content`);
  }

  const parsed = parseJsonStrict(content);
  if (!validateRawResponse(parsed)) {
    throw new Error(
      `Claude returned malformed JSON shape: ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  return parsed;
}

/**
 * Parse JSON tolerating leading/trailing fence markers (` ``` ` or ` ```json `)
 * that Claude sometimes emits despite instructions. Throws if the inner
 * payload still doesn't parse.
 */
function parseJsonStrict(text: string): unknown {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(s);
}

function validateRawResponse(v: unknown): v is RawClaudeResponse {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<RawClaudeResponse>;
  return (
    typeof r.excerpt === "string" &&
    Array.isArray(r.topicTags) &&
    r.topicTags.every((t) => typeof t === "string") &&
    Array.isArray(r.currencyConcerns) &&
    r.currencyConcerns.every((c) => typeof c === "string") &&
    typeof r.needsReview === "boolean"
  );
}

// =============================================================================
// Assembly
// =============================================================================

function assemblePolished(
  post: TransformedPost,
  raw: RawClaudeResponse,
  allowlist?: Map<string, number>,
): PolishedPost {
  // Excerpt: cap at 220 chars (DB has no formal cap but our UI does).
  const excerpt = raw.excerpt.trim().slice(0, 220);

  // Tag filter: keep Claude's tag if it ALSO exists in the WP corpus with
  // count >= 2 (per Phase A4 sprawl filter). If no allowlist provided
  // (e.g. unit tests), keep all Claude tags.
  const claudeTags = raw.topicTags
    .map((t) => t.toLowerCase().trim())
    .filter((t) => /^[a-z0-9-]+$/.test(t));
  const filtered = allowlist
    ? claudeTags.filter((t) => (allowlist.get(t) ?? 0) >= 2)
    : claudeTags;

  // needsReview: trust Claude's flag, but also flag if body is very short.
  const needsReview =
    raw.needsReview ||
    raw.currencyConcerns.length > 0 ||
    post.contentMd.length < 300;

  return {
    ...post,
    excerpt,
    claudeTags: filtered,
    currencyConcerns: raw.currencyConcerns,
    needsReview,
  };
}

function failureFallback(post: TransformedPost, reason: string): PolishedPost {
  return {
    ...post,
    excerpt: post.rawExcerpt.trim().slice(0, 220),
    claudeTags: [],
    currencyConcerns: [reason],
    needsReview: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
