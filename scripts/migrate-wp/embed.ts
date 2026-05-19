// embed.ts — Voyage AI voyage-3-large 1024-dim embeddings.
//
// Anthropic-recommended embedding provider per CEO E2 decision. Cosine
// distance matches our pgvector HNSW index (`vector_cosine_ops`). Voyage
// normalises embeddings to unit length so cosine ≈ dot product.
//
// Cost: ~$0.18 / 1M tokens. 253 posts × ~2K tokens avg = ~$0.10 backfill.
//
// Embedding text: title + excerpt + first 1500 chars of body. Captures
// semantic intent without paying for huge token counts on long posts.
// Voyage supports up to 32K tokens per document; we stay well under.

import type { EmbeddedPost, PolishedPost } from "./types";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-large";
const EMBEDDING_DIMS = 1024;

// =============================================================================
// Public API
// =============================================================================

export interface EmbedOptions {
  /** Voyage API key. Reads from env if omitted. */
  apiKey?: string;
}

export async function embedPost(
  post: PolishedPost,
  opts: EmbedOptions = {},
): Promise<EmbeddedPost> {
  const apiKey = opts.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new EmbedError(
      post.sourceWpId,
      "VOYAGE_API_KEY is not set — cannot generate embeddings.",
    );
  }

  const text = buildEmbeddingText(post);

  // Retry up to 3 times on transient failures.
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const embedding = await callVoyage(apiKey, text);
      if (embedding.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Voyage returned ${embedding.length} dims; expected ${EMBEDDING_DIMS}. ` +
            `Schema column is vector(1024) — wrong model id?`,
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
    `Voyage embedding failed after 3 attempts: ${lastError}`,
  );
}

// =============================================================================
// Text assembly
// =============================================================================

/**
 * Compose the text Voyage embeds. Mirrors search-query semantics:
 *   - title (highest signal)
 *   - excerpt (1-2 sentence summary)
 *   - body lead (first 1500 chars)
 *
 * Avoids the long-tail trailing content which dilutes the embedding
 * for very long posts.
 */
function buildEmbeddingText(post: PolishedPost): string {
  const parts: string[] = [];
  parts.push(post.title);
  if (post.excerpt) parts.push(post.excerpt);
  if (post.contentMd) parts.push(post.contentMd.slice(0, 1500));
  return parts.join("\n\n");
}

// =============================================================================
// Voyage API call
// =============================================================================

interface VoyageResponse {
  object: string;
  data: Array<{ embedding: number[]; index: number; object: string }>;
  model: string;
  usage: { total_tokens: number };
  detail?: string; // error message field on failures
}

async function callVoyage(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      // 'document' = indexing-time embedding (for posts being stored).
      // 'query' would be used at search time on user queries.
      input_type: "document",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as VoyageResponse;
  if (json.detail) throw new Error(`Voyage API error: ${json.detail}`);
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`Voyage response missing embedding array`);
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
