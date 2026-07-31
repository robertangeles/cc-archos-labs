import "server-only";
import { and, desc, eq, sql, lt } from "drizzle-orm";
import { getDb } from "../db";
import {
  conversation,
  message,
  conversationShare,
  conversationDocument,
} from "../db/schema";
import { cleanupConversationDocuments } from "./attachments/service";

const MESSAGE_PAGE_SIZE = 100;

export async function listConversations(userId: string) {
  const db = getDb();
  return db
    .select({
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      systemPrompt: conversation.systemPrompt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    })
    .from(conversation)
    .where(eq(conversation.userId, userId))
    .orderBy(desc(conversation.updatedAt));
}

export async function getConversation(
  conversationId: string,
  userId: string,
  before?: string,
) {
  const db = getDb();
  const [convo] = await db
    .select()
    .from(conversation)
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.userId, userId)),
    )
    .limit(1);

  if (!convo) return null;

  const messagesQuery = db
    .select()
    .from(message)
    .where(
      before
        ? and(
            eq(message.conversationId, conversationId),
            lt(message.createdAt, new Date(before)),
          )
        : eq(message.conversationId, conversationId),
    )
    .orderBy(desc(message.createdAt))
    .limit(MESSAGE_PAGE_SIZE + 1);

  const rows = await messagesQuery;
  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const messages = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();

  return { conversation: convo, messages, hasMore };
}

export async function createConversation(
  userId: string,
  model: string,
  title?: string,
  systemPrompt?: string,
) {
  const db = getDb();
  const [created] = await db
    .insert(conversation)
    .values({
      userId,
      model,
      title: title ?? "New Chat",
      systemPrompt: systemPrompt ?? null,
    })
    .returning();
  return created;
}

export async function updateConversation(
  conversationId: string,
  userId: string,
  updates: { title?: string; systemPrompt?: string | null; model?: string },
) {
  const db = getDb();
  const [existing] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.userId, userId)),
    )
    .limit(1);

  if (!existing) return null;

  const [updated] = await db
    .update(conversation)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(conversation.id, conversationId))
    .returning();
  return updated;
}

export async function deleteConversation(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.userId, userId)),
    )
    .limit(1);

  if (!existing) return false;

  // Capture attached document ids BEFORE the delete — the row cascade removes
  // the conversation_document join rows but cannot delete the R2 objects, and
  // documents cascade from users (not from conversation). Without this, every
  // deleted conversation orphans confidential bytes (OV #1).
  const attached = await db
    .select({ documentId: conversationDocument.documentId })
    .from(conversationDocument)
    .where(eq(conversationDocument.conversationId, conversationId));

  await db
    .delete(conversation)
    .where(eq(conversation.id, conversationId));

  await cleanupConversationDocuments(
    conversationId,
    userId,
    attached.map((a) => a.documentId),
  );
  return true;
}

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  model?: string,
  tokens?: number,
  isInterrupted?: boolean,
  contentType?: "text" | "image_url" | "image_base64",
  sources?: Array<{ title: string; author: string | null }>,
) {
  const db = getDb();
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      // Empty array and null both mean "nothing to cite"; store null so the
      // column reads the same for an ungrounded answer and a pre-0041 row.
      sources: sources && sources.length > 0 ? sources : null,
      role,
      content,
      contentType: contentType ?? "text",
      model: model ?? null,
      tokens: tokens ?? 0,
      isInterrupted: isInterrupted ?? false,
    })
    .returning();

  await db
    .update(conversation)
    .set({ updatedAt: new Date() })
    .where(eq(conversation.id, conversationId));

  return msg;
}

export async function searchConversations(userId: string, query: string) {
  const db = getDb();
  const sanitized = query.replace(/[^\w\s]/g, " ").trim();
  if (!sanitized) return [];

  const tsQuery = sanitized.split(/\s+/).join(" & ");

  const results = await db.execute<{
    id: string;
    title: string;
    updated_at: string;
    snippet: string;
  }>(sql`
    SELECT DISTINCT c.id, c.title, c.updated_at,
      ts_headline('english', m.content, to_tsquery('english', ${tsQuery}),
        'MaxWords=30, MinWords=15, StartSel=**, StopSel=**') as snippet
    FROM conversation c
    JOIN message m ON m.conversation_id = c.id
    WHERE c.user_id = ${userId}
      AND to_tsvector('english', m.content) @@ to_tsquery('english', ${tsQuery})
    ORDER BY c.updated_at DESC
    LIMIT 20
  `);

  return [...results];
}

export async function createShareSnapshot(
  conversationId: string,
  userId: string,
) {
  const db = getDb();
  const [convo] = await db
    .select()
    .from(conversation)
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.userId, userId)),
    )
    .limit(1);

  if (!convo) return null;

  const messages = await db
    .select({
      role: message.role,
      content: message.content,
      contentType: message.contentType,
      model: message.model,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(message.createdAt);

  const [share] = await db
    .insert(conversationShare)
    .values({
      conversationId,
      userId,
      title: convo.title,
      content: messages,
      modelUsed: convo.model,
    })
    .returning();

  return share;
}

export async function getShareByToken(token: string) {
  const db = getDb();
  const [share] = await db
    .select()
    .from(conversationShare)
    .where(eq(conversationShare.token, token))
    .limit(1);

  if (!share) return null;
  if (new Date() > share.expiresAt) return { expired: true as const };
  return share;
}
