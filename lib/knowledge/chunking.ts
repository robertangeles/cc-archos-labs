const MAX_TOKENS = 1000;
const OVERLAP_TOKENS = 200;
const MAX_CHUNKS_PER_DOCUMENT = 500;

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

  return chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT);
}
