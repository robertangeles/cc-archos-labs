// Ingest a PDF into the knowledge base.
// Usage: pnpm ingest:pdf /path/to/dmbok.pdf "DMBOK2" dmbok
//
// Reads the file directly from disk — no HTTP, no body size limits.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const [, , filePath, title, category = "dmbok"] = process.argv;

if (!filePath || !title) {
  console.error("Usage: pnpm ingest:pdf <pdf-path> <title> [category]");
  console.error('Example: pnpm ingest:pdf ./dmbok.pdf "DMBOK2 - Data Management Body of Knowledge" dmbok');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY not set");
  process.exit(1);
}

const EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? "openai/text-embedding-3-large";
const EMBED_DIMS = 1024;
const MAX_TOKENS = 1000;
const OVERLAP = 200;

const sql = postgres(url, { max: 1, ssl: "require" });

// --- PDF parsing ---

console.log(`Reading ${filePath}...`);
const fileBuffer = readFileSync(filePath);
console.log(`File size: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB`);

console.log("Parsing PDF...");
const parsed = await pdfParse(fileBuffer);
console.log(`Extracted ${parsed.text.length} characters, ${parsed.numpages} pages`);

if (!parsed.text.trim()) {
  console.error("PDF contains no extractable text");
  process.exit(1);
}

// --- Dedup check ---

const contentHash = createHash("sha256").update(parsed.text).digest("hex");
const existing = await sql`SELECT id FROM knowledge_document WHERE content_hash = ${contentHash}`;
if (existing.length > 0) {
  console.error(`Document with identical content already exists (id: ${existing[0].id})`);
  process.exit(1);
}

// --- Chunking ---

function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 0.75);
}

function getOverlapParts(parts, overlapTokens) {
  const result = [];
  let tokens = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const pt = estimateTokens(parts[i]);
    if (tokens + pt > overlapTokens) break;
    result.unshift(parts[i]);
    tokens += pt;
  }
  return result;
}

function chunkText(text) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const totalTokens = estimateTokens(cleaned);
  if (totalTokens <= MAX_TOKENS) {
    return [{ text: cleaned, tokenCount: totalTokens }];
  }

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks = [];
  let currentParts = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (paraTokens > MAX_TOKENS) {
      if (currentParts.length > 0) {
        const ct = currentParts.join("\n\n");
        chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
        currentParts = getOverlapParts(currentParts, OVERLAP);
        currentTokens = estimateTokens(currentParts.join("\n\n"));
      }
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (currentTokens + sentTokens > MAX_TOKENS && currentParts.length > 0) {
          const ct = currentParts.join(" ");
          chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
          currentParts = getOverlapParts(currentParts, OVERLAP);
          currentTokens = estimateTokens(currentParts.join(" "));
        }
        currentParts.push(sentence.trim());
        currentTokens += sentTokens;
      }
      continue;
    }

    if (currentTokens + paraTokens > MAX_TOKENS && currentParts.length > 0) {
      const ct = currentParts.join("\n\n");
      chunks.push({ text: ct, tokenCount: estimateTokens(ct) });
      currentParts = getOverlapParts(currentParts, OVERLAP);
      currentTokens = estimateTokens(currentParts.join("\n\n"));
    }

    currentParts.push(para);
    currentTokens += paraTokens;
  }

  if (currentParts.length > 0) {
    const ct = currentParts.join("\n\n");
    const tokens = estimateTokens(ct);
    if (tokens > 0) chunks.push({ text: ct, tokenCount: tokens });
  }

  return chunks.slice(0, 500);
}

console.log("Chunking...");
const chunks = chunkText(parsed.text);
console.log(`Created ${chunks.length} chunks`);

// --- Insert document ---

const [doc] = await sql`
  INSERT INTO knowledge_document (title, source_type, category, content_hash, status, chunk_count)
  VALUES (${title}, 'pdf', ${category}, ${contentHash}, 'processing', ${chunks.length})
  RETURNING id
`;
console.log(`Document created: ${doc.id}`);

// --- Embed and insert chunks ---

async function embedText(text) {
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
      input: text,
      dimensions: EMBED_DIMS,
      encoding_format: "float",
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return json.data?.[0]?.embedding;
}

let embedded = 0;
let failed = 0;

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  let embedding = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      embedding = await embedText(chunk.text);
      break;
    } catch (err) {
      if (attempt < 2) {
        console.log(`  Retry ${attempt + 1} for chunk ${i}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  const vectorStr = embedding ? `[${embedding.join(",")}]` : null;

  await sql`
    INSERT INTO knowledge_chunk (document_id, content, embedding, chunk_index, metadata)
    VALUES (
      ${doc.id},
      ${chunk.text},
      ${vectorStr ? sql`${vectorStr}::vector` : sql`NULL`},
      ${i},
      ${JSON.stringify({ tokenCount: chunk.tokenCount })}
    )
  `;

  if (embedding) {
    embedded++;
  } else {
    failed++;
  }

  if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
    console.log(`  ${i + 1}/${chunks.length} chunks (${embedded} embedded, ${failed} failed)`);
  }
}

// --- Update document status ---

await sql`
  UPDATE knowledge_document
  SET status = 'ready', updated_at = NOW()
  WHERE id = ${doc.id}
`;

console.log(`\nDone. Document "${title}" ingested:`);
console.log(`  ${chunks.length} chunks, ${embedded} embedded, ${failed} failed`);
console.log(`  Document ID: ${doc.id}`);

await sql.end();
