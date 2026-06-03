import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { knowledgeDocument, knowledgeChunk } from "@/lib/db/schema";
import { embedText } from "@/lib/embeddings";
import { chunkText } from "./chunking";

const EMBED_BATCH_SIZE = 50;
const EMBED_MAX_RETRIES = 3;

export class IngestError extends Error {
  override name = "IngestError";
}

export async function ingestDocument(
  title: string,
  sourceType: string,
  category: string,
  rawText: string,
): Promise<string> {
  const db = getDb();

  const contentHash = createHash("sha256").update(rawText).digest("hex");

  const existing = await db
    .select({ id: knowledgeDocument.id })
    .from(knowledgeDocument)
    .where(eq(knowledgeDocument.contentHash, contentHash))
    .limit(1);

  if (existing.length > 0) {
    throw new IngestError(
      `Document with identical content already exists (id: ${existing[0].id}).`,
    );
  }

  const [doc] = await db
    .insert(knowledgeDocument)
    .values({
      title,
      sourceType,
      category,
      contentHash,
      status: "processing",
    })
    .returning({ id: knowledgeDocument.id });

  try {
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new IngestError("Document produced zero chunks after splitting.");
    }

    const embeddings = await embedChunks(chunks.map((c) => c.text));

    const chunkRows = chunks.map((chunk, i) => ({
      documentId: doc.id,
      content: chunk.text,
      embedding: embeddings[i],
      chunkIndex: i,
      metadata: { tokenCount: chunk.tokenCount },
    }));

    await db.insert(knowledgeChunk).values(chunkRows);

    await db
      .update(knowledgeDocument)
      .set({
        status: "ready",
        chunkCount: chunks.length,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocument.id, doc.id));

    return doc.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(knowledgeDocument)
      .set({
        status: "failed",
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocument.id, doc.id));
    throw err;
  }
}

async function embedChunks(
  texts: string[],
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    let lastError: unknown;

    for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
      try {
        const embeddings = await Promise.all(
          batch.map((text) =>
            embedText(text).catch(() => null),
          ),
        );
        for (let j = 0; j < embeddings.length; j++) {
          results[i + j] = embeddings[j];
        }
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < EMBED_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }

    if (lastError) {
      console.error(
        `Embedding batch failed after ${EMBED_MAX_RETRIES} retries (start index: ${i})`,
      );
    }
  }

  return results;
}

export async function deleteDocument(documentId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(knowledgeDocument)
    .where(eq(knowledgeDocument.id, documentId));
}

export async function listDocuments() {
  const db = getDb();
  return db
    .select({
      id: knowledgeDocument.id,
      title: knowledgeDocument.title,
      sourceType: knowledgeDocument.sourceType,
      category: knowledgeDocument.category,
      status: knowledgeDocument.status,
      chunkCount: knowledgeDocument.chunkCount,
      lastError: knowledgeDocument.lastError,
      createdAt: knowledgeDocument.createdAt,
    })
    .from(knowledgeDocument)
    .orderBy(knowledgeDocument.createdAt);
}
