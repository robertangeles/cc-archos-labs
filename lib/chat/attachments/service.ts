import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { document, conversationDocument, conversation } from "../../db/schema";
import {
  r2ChatConfigFromIntegration,
  buildR2ChatClient,
  putChatDocument,
  deleteChatDocument,
  R2ChatNotConfiguredError,
} from "../../r2-chat-documents";
import { extractDocument, MAX_UPLOAD_BYTES, isAllowedExtension } from "./extract";
import { logAttachmentEvent } from "./observability";

// Orchestration for chat Attach Files: upload → extract → store (private R2) →
// insert document + join; list; detach (ref-counted object cleanup); and the
// conversation/account-delete cleanup hooks. All operations are owner-scoped.

export const MAX_DOCS_PER_CONVERSATION = 5;

export class ConversationNotFoundError extends Error {
  override name = "ConversationNotFoundError";
}
export class DocumentNotFoundError extends Error {
  override name = "DocumentNotFoundError";
}
export class TooManyAttachmentsError extends Error {
  override name = "TooManyAttachmentsError";
}
export class FileTooLargeError extends Error {
  override name = "FileTooLargeError";
}

async function assertConversationOwner(
  conversationId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.userId, userId)),
    )
    .limit(1);
  if (!row) throw new ConversationNotFoundError();
}

export interface UploadedDocument {
  id: string;
  fileName: string;
  fileType: string;
  byteSize: number;
  charCount: number;
  snippet: string;
}

export interface UploadResult {
  ok: boolean;
  document?: UploadedDocument;
  error?: string;
  errorReason?: string | null;
}

/**
 * Upload a document to a conversation: validate → extract text → store bytes in
 * the private bucket (keyed by the new document id) → insert document + join.
 * Only READY documents are persisted; a scanned/unsupported/failed extraction
 * returns a message and stores nothing.
 */
export async function uploadAttachment(params: {
  userId: string;
  conversationId: string;
  buffer: Buffer;
  fileName: string;
  fileType: string;
}): Promise<UploadResult> {
  const { userId, conversationId, buffer, fileName, fileType } = params;
  await assertConversationOwner(conversationId, userId);

  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError();
  if (!isAllowedExtension(fileName)) {
    logAttachmentEvent({
      event: "upload_rejected",
      userId,
      conversationId,
      fileType,
      byteSize: buffer.byteLength,
      errorReason: "unsupported_type",
    });
    return {
      ok: false,
      error: "Unsupported file type. Allowed: PDF, TXT, MD, DOCX.",
      errorReason: "unsupported_type",
    };
  }

  const db = getDb();
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationDocument)
    .where(eq(conversationDocument.conversationId, conversationId));
  if ((countRow?.count ?? 0) >= MAX_DOCS_PER_CONVERSATION) {
    throw new TooManyAttachmentsError();
  }

  const extracted = await extractDocument(buffer, fileName);
  if (extracted.status !== "ready") {
    logAttachmentEvent({
      event: "extract_failed",
      userId,
      conversationId,
      fileType,
      byteSize: buffer.byteLength,
      errorReason: extracted.errorReason,
    });
    return {
      ok: false,
      error: extracted.message ?? "Couldn't read this file.",
      errorReason: extracted.errorReason,
    };
  }

  const storage = await r2ChatConfigFromIntegration();
  if (!storage) throw new R2ChatNotConfiguredError();

  const id = randomUUID();
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const client = buildR2ChatClient(storage);
  await putChatDocument({
    config: storage,
    client,
    key: id,
    body: buffer,
    contentType: fileType,
  });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(document).values({
        id,
        userId,
        fileName,
        fileType,
        byteSize: buffer.byteLength,
        contentHash,
        storageKey: id,
        extractedText: extracted.extractedText,
        charCount: extracted.charCount,
        status: "ready",
      });
      await tx
        .insert(conversationDocument)
        .values({ conversationId, documentId: id });
    });
  } catch (err) {
    // Insert failed after the object was stored — delete the orphan bytes so no
    // confidential file is left in the bucket with no row pointing at it.
    await deleteChatDocument({ config: storage, client, key: id }).catch(() => {});
    throw err;
  }

  logAttachmentEvent({
    event: "upload_ready",
    userId,
    conversationId,
    documentId: id,
    fileType,
    byteSize: buffer.byteLength,
    charCount: extracted.charCount,
  });

  return {
    ok: true,
    document: {
      id,
      fileName,
      fileType,
      byteSize: buffer.byteLength,
      charCount: extracted.charCount,
      snippet: extracted.extractedText.slice(0, 300),
    },
  };
}

/** List the documents attached to a conversation (owner-scoped, newest first). */
export async function listAttachments(userId: string, conversationId: string) {
  await assertConversationOwner(conversationId, userId);
  const db = getDb();
  return db
    .select({
      id: document.id,
      fileName: document.fileName,
      fileType: document.fileType,
      byteSize: document.byteSize,
      charCount: document.charCount,
      // First ~300 chars of the extracted text for the E2 preview tooltip
      // (SQL-side slice — never load the full text just to preview it).
      snippet: sql<string | null>`left(${document.extractedText}, 300)`,
      status: document.status,
      createdAt: document.createdAt,
    })
    .from(conversationDocument)
    .innerJoin(document, eq(conversationDocument.documentId, document.id))
    .where(
      and(
        eq(conversationDocument.conversationId, conversationId),
        eq(document.userId, userId),
      ),
    )
    .orderBy(desc(document.createdAt));
}

/**
 * Load a conversation's ready documents for context injection (owner-scoped,
 * newest first). Only extracted_text + fileName — never the bytes.
 */
export async function loadConversationDocuments(
  conversationId: string,
  userId: string,
): Promise<Array<{ fileName: string; extractedText: string }>> {
  const db = getDb();
  const rows = await db
    .select({
      fileName: document.fileName,
      extractedText: document.extractedText,
    })
    .from(conversationDocument)
    .innerJoin(document, eq(conversationDocument.documentId, document.id))
    .where(
      and(
        eq(conversationDocument.conversationId, conversationId),
        eq(document.userId, userId),
        eq(document.status, "ready"),
      ),
    )
    .orderBy(desc(document.createdAt));
  return rows
    .filter((r): r is { fileName: string; extractedText: string } =>
      Boolean(r.extractedText),
    )
    .map((r) => ({ fileName: r.fileName, extractedText: r.extractedText }));
}

/**
 * Fetch one owned document's storage key + type for the download proxy.
 */
export async function getOwnedDocument(userId: string, documentId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: document.id,
      fileName: document.fileName,
      fileType: document.fileType,
      storageKey: document.storageKey,
    })
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Delete a document + its R2 object IFF no conversation still references it.
 * v1 is 1:1, so this always deletes; the ref-count check makes the E4 reuse
 * fast-follow a no-op flip. (OV #7: a single-statement atomic delete replaces
 * this check-then-delete when concurrent detach becomes possible under reuse.)
 */
export async function deleteDocumentIfOrphaned(
  documentId: string,
  userId: string,
): Promise<void> {
  const db = getDb();
  const [stillReferenced] = await db
    .select({ id: conversationDocument.id })
    .from(conversationDocument)
    .where(eq(conversationDocument.documentId, documentId))
    .limit(1);
  if (stillReferenced) return;

  const [doc] = await db
    .select({ storageKey: document.storageKey })
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)))
    .limit(1);
  if (!doc) return;

  await db
    .delete(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)));

  if (doc.storageKey) {
    await deleteObject(doc.storageKey);
  }
}

/** Detach a document from a conversation; delete it if now orphaned. */
export async function detachDocument(
  userId: string,
  conversationId: string,
  documentId: string,
): Promise<void> {
  await assertConversationOwner(conversationId, userId);
  const db = getDb();
  const [owned] = await db
    .select({ id: document.id })
    .from(document)
    .where(and(eq(document.id, documentId), eq(document.userId, userId)))
    .limit(1);
  if (!owned) throw new DocumentNotFoundError();

  await db
    .delete(conversationDocument)
    .where(
      and(
        eq(conversationDocument.conversationId, conversationId),
        eq(conversationDocument.documentId, documentId),
      ),
    );
  await deleteDocumentIfOrphaned(documentId, userId);
}

/**
 * OV #1: called from deleteConversation BEFORE the row cascade removes the join
 * rows. Deletes the R2 objects + document rows that this conversation orphans.
 */
export async function cleanupConversationDocuments(
  conversationId: string,
  userId: string,
  documentIds: string[],
): Promise<void> {
  for (const documentId of documentIds) {
    await deleteDocumentIfOrphaned(documentId, userId).catch((err) => {
      console.error(
        "[attachments] cleanupConversationDocuments failed for",
        documentId,
        err,
      );
    });
  }
}

/**
 * OV #6: delete every one of a user's document objects (+ rows). Call from the
 * account-deletion path BEFORE the users row cascade — the cascade drops the
 * document rows but cannot delete R2 objects.
 */
export async function deleteAllUserDocuments(userId: string): Promise<void> {
  const db = getDb();
  const docs = await db
    .select({ id: document.id, storageKey: document.storageKey })
    .from(document)
    .where(eq(document.userId, userId));
  for (const doc of docs) {
    if (doc.storageKey) await deleteObject(doc.storageKey).catch(() => {});
  }
  await db.delete(document).where(eq(document.userId, userId));
}

async function deleteObject(storageKey: string): Promise<void> {
  const storage = await r2ChatConfigFromIntegration();
  if (!storage) return;
  const client = buildR2ChatClient(storage);
  await deleteChatDocument({ config: storage, client, key: storageKey }).catch(
    (err) => {
      console.error("[attachments] R2 delete failed for", storageKey, err);
    },
  );
}
