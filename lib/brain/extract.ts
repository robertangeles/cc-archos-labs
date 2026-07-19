import { captureToDb } from "./memory";

/**
 * Capture a chat turn into the user's brain. Distills the USER message into
 * clean atomic facts — the distillation layer extracts from the user's own
 * words only (anti-confabulation), so the assistant reply is not needed — then
 * consolidates (dedup / supersede). Fired fire-and-forget from the streaming
 * path; stores nothing for greetings/questions and never throws.
 */
export async function extractMemories(
  userId: string,
  userMessage: string,
  conversationId: string | null = null,
): Promise<void> {
  return captureToDb(userId, userMessage, conversationId);
}
