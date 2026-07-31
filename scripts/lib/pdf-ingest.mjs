// Shared PDF ingest primitives: extract, chunk, embed, insert.
//
// Used by scripts/ingest-pdf.mjs (one file) and scripts/ingest-bulk.mjs (a
// folder). Written once because there were already two copies of the chunking
// algorithm — this file and lib/knowledge/chunking.ts — and a third would have
// meant a fix landing in one of three places.
//
// Deliberately NOT importing lib/knowledge/chunking.ts: that module is
// `server-only` TypeScript and cannot be loaded from a plain node script. The
// duplication is real; the semantics are kept identical on purpose and a test
// asserts they agree (scripts/lib/pdf-ingest.test.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const MAX_TOKENS = 1000;
export const OVERLAP_TOKENS = 200;
// Matches MAX_CHUNKS_PER_DOCUMENT in lib/knowledge/chunking.ts. Both FAIL LOUD
// rather than truncating: the old silent .slice(0, 500) meant a long book lost
// its tail while chunk_count recorded the truncated number, so the admin page
// showed a healthy "ready" document.
export const MAX_CHUNKS = 2000;

export const EMBED_MODEL =
  process.env.OPENROUTER_EMBED_MODEL ?? "openai/text-embedding-3-large";
export const EMBED_DIMS = 1024;

export function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 0.75);
}

function overlapParts(parts, overlapTokens) {
  const out = [];
  let tokens = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = estimateTokens(parts[i]);
    if (tokens + t > overlapTokens) break;
    out.unshift(parts[i]);
    tokens += t;
  }
  return out;
}

/** Paragraph-boundary chunking with overlap. Mirrors lib/knowledge/chunking.ts. */
export function chunkText(text, maxTokens = MAX_TOKENS, overlap = OVERLAP_TOKENS) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (estimateTokens(cleaned) <= maxTokens) return [cleaned];

  const chunks = [];
  let current = [];
  let currentTokens = 0;

  for (const para of cleaned.split(/\n\n+/)) {
    const paraTokens = estimateTokens(para);

    if (paraTokens > maxTokens) {
      if (current.length > 0) {
        chunks.push(current.join("\n\n"));
        current = overlapParts(current, overlap);
        currentTokens = estimateTokens(current.join("\n\n"));
      }
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (currentTokens + sentTokens > maxTokens && current.length > 0) {
          chunks.push(current.join(" "));
          current = overlapParts(current, overlap);
          currentTokens = estimateTokens(current.join(" "));
        }
        current.push(sentence.trim());
        currentTokens += sentTokens;
      }
      continue;
    }

    if (currentTokens + paraTokens > maxTokens && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = overlapParts(current, overlap);
      currentTokens = estimateTokens(current.join("\n\n"));
    }
    current.push(para);
    currentTokens += paraTokens;
  }

  if (current.length > 0) {
    const tail = current.join("\n\n");
    if (estimateTokens(tail) > 0) chunks.push(tail);
  }

  if (chunks.length > MAX_CHUNKS) {
    throw new Error(
      `Produced ${chunks.length} chunks, over the ${MAX_CHUNKS} limit. ` +
        `Refusing to truncate silently — a half-ingested book is ` +
        `indistinguishable from a complete one once it is in the vector store.`,
    );
  }
  return chunks;
}

export async function extractPdf(filePath) {
  const buffer = readFileSync(filePath);
  // Hash the FILE BYTES, not the extracted text, so the dedup key stays stable
  // even as extraction or sanitisation changes.
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const parsed = await pdfParse(buffer);
  return { text: sanitiseText(parsed.text), pages: parsed.numpages, contentHash };
}

/**
 * Strip control characters Postgres cannot store.
 *
 * Shoe Dog killed a live ingest with
 *   invalid byte sequence for encoding "UTF8": 0x00
 * A Postgres `text` column rejects NUL outright, and PDF extraction produces
 * them from embedded fonts and form fields often enough that this is a
 * when-not-if failure rather than a freak one. Other C0 controls are equally
 * meaningless in book prose and equally likely to trip something downstream.
 *
 * Tab, newline and carriage return are KEPT: the chunker splits on paragraph
 * breaks, so stripping newlines here would silently collapse an entire book
 * into one enormous chunk.
 */
export function sanitiseText(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/**
 * Embed many texts per request.
 *
 * The single-file script embeds one chunk per HTTP call. At ~250 chunks a book
 * that is fine; across a 22-book shelf it is ~5,500 sequential round trips and
 * roughly twenty minutes of waiting. Batching turns that into a couple of
 * minutes for identical cost — the API prices per token, not per request.
 */
export async function embedBatch(texts, apiKey, batchSize = 64) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let lastErr = "";
    let embedded = null;

    for (let attempt = 1; attempt <= 3 && !embedded; attempt++) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://archoslabs.xyz",
            "X-Title": "Archos Labs",
          },
          body: JSON.stringify({
            model: EMBED_MODEL,
            input: batch,
            dimensions: EMBED_DIMS,
            encoding_format: "float",
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        // The API may return results out of order; `index` is authoritative.
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        if (sorted.length !== batch.length) {
          throw new Error(`asked for ${batch.length} embeddings, got ${sorted.length}`);
        }
        embedded = sorted.map((d) => d.embedding);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }

    if (!embedded) throw new Error(`Embedding failed after 3 attempts: ${lastErr}`);
    for (const e of embedded) {
      if (e.length !== EMBED_DIMS) {
        throw new Error(`Embedding has ${e.length} dims, expected ${EMBED_DIMS}`);
      }
      out.push(e);
    }
    if (typeof process.stdout.write === "function") {
      process.stdout.write(`\r    embedded ${out.length}/${texts.length}`);
    }
  }
  process.stdout.write("\n");
  return out;
}

/**
 * Is this extracted text actually natural language?
 *
 * Chunk count is NOT the detector. Zero to One extracted 268,946 characters
 * across 160 pages — healthy by every size measure — and every one of them was
 * gibberish: the PDF uses a custom font encoding, so pdf-parse returned raw
 * glyph codes. Its opening reads "&RS\ULJKW ... 3HWHU 7KLHO", which is
 * "Copyright ... Peter Thiel" shifted by three. It would have entered the
 * library as 16 chunks of nonsense that Metis would cite as Zero to One.
 *
 * The tell is word length. English averages ~5 characters per word; that file
 * averages 28, because its word separator is U+0003 rather than a space.
 *
 * Also catches the opposite failure: a PDF with no text layer at all (a scan),
 * which yields a couple of characters per page.
 */
export function textQuality(text, pages) {
  const words = text.split(/\s+/).filter(Boolean);
  const avgWordLen = words.length ? text.replace(/\s/g, "").length / words.length : 0;
  const charsPerPage = pages > 0 ? text.length / pages : 0;

  const problems = [];

  // CALIBRATED, not guessed. Measured across a 22-book shelf:
  //   every readable book   4.6 - 5.5 characters per word
  //   font-encoded garbage  27.6
  //   image-only scans      0 (no words at all)
  // A 5x gap, so 12 sits nowhere near either population.
  if (words.length > 0 && avgWordLen > 12) {
    problems.push(`avg word length ${avgWordLen.toFixed(1)} — text is encoded, not readable`);
  }

  // Same measurement: readable books ran 538 - 2703 chars/page, image-only
  // scans returned 2. An earlier 500 threshold sat uncomfortably close to The
  // Lean Startup's 538; 200 keeps a wide margin on both sides.
  if (charsPerPage < 200) {
    problems.push(`${Math.round(charsPerPage)} chars/page — no usable text layer (scanned?)`);
  }

  // A printable-character ratio was tried and REMOVED. Real typeset books ran
  // 85-99% (em dashes, curly quotes, accented names) against the bad file's
  // 79% — six points of separation, versus word length's fivefold. It rejected
  // three perfectly good books. A second signal that overlaps the populations
  // does not add confidence, it just costs recall.

  return { ok: problems.length === 0, avgWordLen, charsPerPage, problems };
}
