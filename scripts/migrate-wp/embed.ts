// embed.ts — OpenAI `text-embedding-3-large` via OpenRouter.
//
// Per VOY-2 decision (post-CEO/Eng review revision): route embeddings
// through the existing OpenRouter API key rather than adding Voyage as a
// new vendor. Trade-off: marginal quality drop vs Voyage on long-form
// English; gain: one less vendor in the ops surface (reuses
// OPENROUTER_API_KEY already wired for the Claude polish stage).
//
// OpenAI's text-embedding-3-* models support a `dimensions` parameter
// that lets us request 1024 dims (matching the pgvector vector(1024)
// column on the post table) instead of the native 3072. Quality drops
// gracefully; cosine distances stay coherent.
//
// Cost: ~$0.13 per 1M tokens at text-embedding-3-large. 253 posts ×
// ~2K tokens avg = ~$0.07 backfill. Sub-cent per future search query.
//
// Embedding text: title + excerpt + first 1500 chars of body. Captures
// semantic intent without paying for long-tail tokens.

import type { EmbeddedPost, PolishedPost } from "./types";

const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-large";
const EMBEDDING_DIMS = 1024;

// =============================================================================
// Public API
// =============================================================================

export interface EmbedOptions {
  /** OpenRouter API key. Reads from env if omitted. */
  apiKey?: string;
  /** Override model id (e.g. for switching to text-embedding-3-small). */
  modelId?: string;
  /** Override dimension count. Must match the pgvector column width. */
  dimensions?: number;
}

export async function embedPost(
  post: PolishedPost,
  opts: EmbedOptions = {},
): Promise<EmbeddedPost> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new EmbedError(
      post.sourceWpId,
      "OPENROUTER_API_KEY is not set — cannot generate embeddings.",
    );
  }
  // Resolution order: explicit override > env > hardcoded default.
  // When the /admin/integrations "Embeddings Model ID" field lands in a
  // follow-up PR, the runtime path will read from integration-config
  // (the Settings tier per CLAUDE.md). This script keeps env override
  // because it runs outside the Next.js server-only context.
  const modelId = opts.modelId ?? process.env.OPENROUTER_EMBED_MODEL ?? EMBED_MODEL;
  const dimensions = opts.dimensions ?? EMBEDDING_DIMS;

  const text = buildEmbeddingText(post);

  // Retry up to 3 times on transient failures.
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const embedding = await callOpenRouter({
        apiKey,
        modelId,
        dimensions,
        text,
      });
      if (embedding.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Embedding endpoint returned ${embedding.length} dims; expected ${EMBEDDING_DIMS}. ` +
            `Schema column is vector(1024) — wrong model or dimensions param?`,
        );
      }
      return { ...post, embedding };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        await sleep(500 * attempt);
      }
    }
  }
  throw new EmbedError(
    post.sourceWpId,
    `Embedding failed after 3 attempts: ${lastError}`,
  );
}

// =============================================================================
// Text assembly
// =============================================================================

/**
 * Compose the text the embedding model ingests. Mirrors search-query
 * semantics: title (highest signal) + excerpt + body lead. Truncated to
 * keep token cost low on long posts.
 */
function buildEmbeddingText(post: PolishedPost): string {
  const parts: string[] = [];
  parts.push(post.title);
  if (post.excerpt) parts.push(post.excerpt);
  if (post.contentMd) parts.push(post.contentMd.slice(0, 1500));
  return parts.join("\n\n");
}

// =============================================================================
// OpenRouter API call
// =============================================================================

interface OpenRouterEmbeddingResponse {
  object: string;
  data: Array<{ embedding: number[]; index: number; object: string }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
  error?: { message: string; code?: string | number };
}

async function callOpenRouter(args: {
  apiKey: string;
  modelId: string;
  dimensions: number;
  text: string;
}): Promise<number[]> {
  const response = await fetch(OPENROUTER_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://archoslabs.xyz",
      "X-Title": "Archos Labs migrate-wp",
    },
    body: JSON.stringify({
      model: args.modelId,
      input: args.text,
      dimensions: args.dimensions,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter embeddings HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as OpenRouterEmbeddingResponse;
  if (json.error) {
    throw new Error(`OpenRouter embeddings API error: ${json.error.message}`);
  }
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`OpenRouter embeddings response missing embedding array`);
  }
  return embedding;
}

// =============================================================================
// Errors + utilities
// =============================================================================

export class EmbedError extends Error {
  constructor(
    public readonly sourceWpId: number,
    message: string,
  ) {
    super(`[post #${sourceWpId}] ${message}`);
    this.name = "EmbedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
