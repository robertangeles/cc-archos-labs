const MAX_TOKENS = 1000;
const OVERLAP_TOKENS = 200;

// Raised from 500 and now enforced by THROWING rather than by silently
// truncating. The old `chunks.slice(0, 500)` discarded the tail of any long
// book without a word: chunk_count recorded the truncated number, so the admin
// page showed "496 chunks, ready" and looked healthy. DMBOK landed at 496 —
// four chunks from the ceiling — so the next long book would have lost its
// ending with no signal at all.
//
// 2000 chunks is roughly 1.6M tokens of source text, comfortably past any book
// in the library (the largest today is 496). A document that exceeds it is
// telling you something is wrong with the input, not that the cap is too small.
export const MAX_CHUNKS_PER_DOCUMENT = 2000;

export class ChunkLimitError extends Error {
  override name = "ChunkLimitError";
  constructor(produced: number, limit: number = MAX_CHUNKS_PER_DOCUMENT) {
    super(
      `Document produced ${produced} chunks, over the ${limit} limit. ` +
        `Refusing to truncate silently — a partially ingested book looks identical ` +
        `to a complete one once it is in the vector store. Split the source or raise ` +
        `MAX_CHUNKS_PER_DOCUMENT deliberately.`,
    );
  }
}

export interface ChunkResult {
  text: string;
  tokenCount: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(
    text
      .split(/\s+/)
      .filter(Boolean).length / 0.75,
  );
}

function getOverlapParts(parts: string[], overlapTokens: number): string[] {
  const result: string[] = [];
  let tokens = 0;

  for (let i = parts.length - 1; i >= 0; i--) {
    const partTokens = estimateTokens(parts[i]);
    if (tokens + partTokens > overlapTokens) break;
    result.unshift(parts[i]);
    tokens += partTokens;
  }

  return result;
}

export function chunkText(
  text: string,
  maxTokens = MAX_TOKENS,
  overlap = OVERLAP_TOKENS,
  // Injectable so the fail-loud guard is testable without generating ~1.5M
  // words of input. Defaults to the real cap in every production call.
  maxChunks = MAX_CHUNKS_PER_DOCUMENT,
): ChunkResult[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const totalTokens = estimateTokens(cleaned);
  if (totalTokens <= maxTokens) {
    return [{ text: cleaned, tokenCount: totalTokens }];
  }

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: ChunkResult[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (paraTokens > maxTokens) {
      if (currentParts.length > 0) {
        const ct = currentParts.join("\n\n");
        chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
        currentParts = getOverlapParts(currentParts, overlap);
        currentTokens = estimateTokens(currentParts.join("\n\n"));
      }

      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (currentTokens + sentTokens > maxTokens && currentParts.length > 0) {
          const ct = currentParts.join(" ");
          chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
          currentParts = getOverlapParts(currentParts, overlap);
          currentTokens = estimateTokens(currentParts.join(" "));
        }
        currentParts.push(sentence.trim());
        currentTokens += sentTokens;
      }
      continue;
    }

    if (currentTokens + paraTokens > maxTokens && currentParts.length > 0) {
      const ct = currentParts.join("\n\n");
      chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
      currentParts = getOverlapParts(currentParts, overlap);
      currentTokens = estimateTokens(currentParts.join("\n\n"));
    }

    currentParts.push(para);
    currentTokens += paraTokens;
  }

  if (currentParts.length > 0) {
    const ct = currentParts.join("\n\n");
    const tokens = estimateTokens(ct);
    if (tokens > 0) {
      chunks.push({ text: ct, tokenCount: tokens });
    }
  }

  if (chunks.length > maxChunks) {
    throw new ChunkLimitError(chunks.length, maxChunks);
  }
  return chunks;
}
