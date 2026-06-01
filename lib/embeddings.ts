import "server-only";

// Shared post-embedding generation. Used by:
//   - scripts/migrate-wp/embed.ts        — migration backfill
//   - lib/posts-admin/* (admin Posts editor save + manual button)
//   - lib/posts-admin/similarity.ts      — query-side embedding for
//                                          "suggest internal links"
//
// Vendor: OpenAI text-embedding-3-large via OpenRouter (per VOY-2
// decision — see scripts/migrate-wp/embed.ts for rationale). 1024
// dimensions matches the `post.embedding vector(1024)` column. The
// `dimensions` parameter on OpenAI's API truncates from native 3072
// gracefully — cosine distances stay coherent.
//
// Cost: ~$0.13 per 1M tokens. A single post embedding (~3K tokens after
// truncation) costs sub-cent. Cheap enough that the admin can call this
// on every save where content shifts >5%, and the suggest-links button
// can call it on every click (rate-limited at the route boundary).

const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-large";
export const EMBEDDING_DIMS = 1024;
const TRUNCATE_BODY_TO_CHARS = 1500;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 3;

export class EmbeddingError extends Error {
  override name = "EmbeddingError";
}

export interface EmbeddingInput {
  title: string;
  excerpt?: string | null;
  contentMd?: string | null;
}

export interface EmbeddingOptions {
  /** OpenRouter API key. Reads from env if omitted. */
  apiKey?: string;
  /** Override model id (e.g. for switching to text-embedding-3-small). */
  modelId?: string;
  /** Override dimension count. MUST match the pgvector column width. */
  dimensions?: number;
}

/**
 * Generate a 1024-dim embedding for a post's semantic content. Composes
 * the embedding text from title + excerpt + truncated body, then calls
 * OpenRouter with the configured model + dimensions. Retries 3x with
 * exponential backoff on transient failures.
 *
 * @throws EmbeddingError if the API key is missing, every retry fails,
 * or the returned vector has the wrong dimension count.
 */
export async function embedPostContent(
  input: EmbeddingInput,
  opts: EmbeddingOptions = {},
): Promise<number[]> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError(
      "OPENROUTER_API_KEY is not set — cannot generate embeddings.",
    );
  }
  // Resolution order: explicit override > env > hardcoded default. Same
  // pattern as scripts/migrate-wp/embed.ts so an `OPENROUTER_EMBED_MODEL`
  // env value switches both surfaces at once.
  const modelId =
    opts.modelId ?? process.env.OPENROUTER_EMBED_MODEL ?? EMBED_MODEL;
  const dimensions = opts.dimensions ?? EMBEDDING_DIMS;

  const text = buildEmbeddingText(input);

  let lastError = "";
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const embedding = await callOpenRouter({
        apiKey,
        modelId,
        dimensions,
        text,
      });
      if (embedding.length !== EMBEDDING_DIMS) {
        throw new EmbeddingError(
          `Embedding endpoint returned ${embedding.length} dims; expected ${EMBEDDING_DIMS}. ` +
            `Schema column is vector(1024) — wrong model or dimensions param?`,
        );
      }
      return embedding;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }
  throw new EmbeddingError(
    `Embedding failed after ${RETRY_ATTEMPTS} attempts: ${lastError}`,
  );
}

/**
 * Compose the text the embedding model ingests. Mirrors search-query
 * semantics: title (highest signal) + excerpt + body lead. Truncated to
 * keep token cost low on long posts.
 *
 * Exported so tests can verify the composition + the truncation
 * threshold, and so the migration script's manifest can record the
 * exact text it embedded.
 */
export function buildEmbeddingText(input: EmbeddingInput): string {
  const parts: string[] = [];
  parts.push(input.title);
  if (input.excerpt) parts.push(input.excerpt);
  if (input.contentMd) parts.push(input.contentMd.slice(0, TRUNCATE_BODY_TO_CHARS));
  return parts.join("\n\n");
}

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
      "X-Title": "Archos Labs",
    },
    body: JSON.stringify({
      model: args.modelId,
      input: args.text,
      dimensions: args.dimensions,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new EmbeddingError(
      `OpenRouter embeddings HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as OpenRouterEmbeddingResponse;
  if (json.error) {
    throw new EmbeddingError(
      `OpenRouter embeddings API error: ${json.error.message}`,
    );
  }
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new EmbeddingError(
      "OpenRouter embeddings response missing embedding array",
    );
  }
  return embedding;
}

/**
 * Generate a 1024-dim embedding for arbitrary text. Lower-level than
 * embedPostContent — used by the knowledge base ingestion pipeline
 * and vector search queries where the input is a plain string rather
 * than a structured post object.
 */
export async function embedText(
  text: string,
  opts: EmbeddingOptions = {},
): Promise<number[]> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError(
      "OPENROUTER_API_KEY is not set — cannot generate embeddings.",
    );
  }
  const modelId =
    opts.modelId ?? process.env.OPENROUTER_EMBED_MODEL ?? EMBED_MODEL;
  const dimensions = opts.dimensions ?? EMBEDDING_DIMS;

  let lastError = "";
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const embedding = await callOpenRouter({
        apiKey,
        modelId,
        dimensions,
        text,
      });
      if (embedding.length !== EMBEDDING_DIMS) {
        throw new EmbeddingError(
          `Embedding returned ${embedding.length} dims; expected ${EMBEDDING_DIMS}.`,
        );
      }
      return embedding;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }
  throw new EmbeddingError(
    `Embedding failed after ${RETRY_ATTEMPTS} attempts: ${lastError}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
