import "server-only";
import {
  OPENROUTER_URL,
  resolveLlmConfig,
  buildAuthHeaders,
} from "../llm/config";
import * as chatService from "./service";
import { getEnabledRules } from "../rules/service";

interface StreamMessageArgs {
  conversationId: string;
  userId: string;
  userContent: string;
  modelOverride?: string;
  systemPrompt?: string | null;
  signal?: AbortSignal;
}

export async function streamMessage(args: StreamMessageArgs): Promise<{
  stream: ReadableStream<Uint8Array>;
  cleanup: () => Promise<void>;
}> {
  console.log("[stream] resolving LLM config, override:", args.modelOverride);
  const { apiKey, modelId } = await resolveLlmConfig(args.modelOverride);
  console.log("[stream] model:", modelId, "key length:", apiKey.length);

  await chatService.saveMessage(
    args.conversationId,
    "user",
    args.userContent,
  );
  console.log("[stream] user message saved");

  const rules = await getEnabledRules(args.userId);
  console.log("[stream] rules loaded:", rules.length);
  const rulesBlock = rules.length > 0
    ? rules.map((r) => r.content).join("\n\n")
    : "";

  const systemParts = [rulesBlock, args.systemPrompt ?? ""].filter(Boolean);
  const systemMessage = systemParts.length > 0
    ? [{ role: "system" as const, content: systemParts.join("\n\n") }]
    : [];

  const priorMessages = await loadConversationHistory(args.conversationId);
  console.log("[stream] history loaded:", priorMessages.length, "messages");
  console.log("[stream] calling OpenRouter:", OPENROUTER_URL, "model:", modelId);

  const openRouterResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: [
        ...systemMessage,
        ...priorMessages,
      ],
    }),
    signal: args.signal,
  });

  console.log("[stream] OpenRouter response:", openRouterResponse.status, openRouterResponse.statusText);

  if (!openRouterResponse.ok) {
    const body = await openRouterResponse.text().catch(() => "");
    console.error("[stream] OpenRouter error:", openRouterResponse.status, body.slice(0, 500));
    const status = openRouterResponse.status;
    if (status === 429) throw new StreamError("Model is busy. Try again in a moment.", 429);
    if (status >= 500) throw new StreamError("AI service temporarily unavailable.", 502);
    throw new StreamError(`OpenRouter error: ${body.slice(0, 200)}`, status);
  }

  if (!openRouterResponse.body) {
    throw new StreamError("No response body from OpenRouter", 502);
  }

  let buffer = "";
  let _inputTokens = 0;
  let outputTokens = 0;
  let aborted = false;

  if (args.signal) {
    args.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  console.log("[stream] starting async read loop");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = openRouterResponse.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) {
            console.log("[stream] done. aborted:", aborted, "buffer:", buffer.length, "chars");
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              console.log("[stream] [DONE] received, buffer:", buffer.length, "chars");
              controller.close();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                buffer += delta;
                controller.enqueue(encoder.encode(delta));
              }
              if (parsed.usage) {
                _inputTokens = parsed.usage.prompt_tokens ?? 0;
                outputTokens = parsed.usage.completion_tokens ?? 0;
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }
      } catch (err) {
        console.error("[stream] error:", err);
        if (!aborted) controller.error(err);
      }
      controller.close();
    },
  });

  const cleanup = async () => {
    if (buffer.length > 0) {
      await chatService.saveMessage(
        args.conversationId,
        "assistant",
        buffer,
        modelId,
        outputTokens,
        aborted,
      );
    }
  };

  return { stream, cleanup };
}

async function loadConversationHistory(conversationId: string) {
  const db = (await import("../db")).getDb();
  const { message: messageTable } = await import("../db/schema");
  const msgs = await db
    .select({ role: messageTable.role, content: messageTable.content })
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .orderBy(messageTable.createdAt);
  return msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

import { eq } from "drizzle-orm";

export class StreamError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

export async function generateTitle(
  conversationId: string,
  firstUserMessage: string,
  firstAssistantMessage: string,
): Promise<void> {
  try {
    const { apiKey, modelId } = await resolveLlmConfig();
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        max_tokens: 30,
        messages: [
          {
            role: "system",
            content:
              "Generate a concise 5-word title for this conversation. Return ONLY the title, no quotes or punctuation.",
          },
          { role: "user", content: firstUserMessage },
          { role: "assistant", content: firstAssistantMessage.slice(0, 200) },
        ],
      }),
    });

    if (!response.ok) return;

    const json = await response.json();
    const title = json.choices?.[0]?.message?.content?.trim();
    if (!title || title.length > 100) return;

    const { getDb } = await import("../db");
    const { conversation } = await import("../db/schema");
    const db = getDb();
    await db
      .update(conversation)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversation.id, conversationId));
  } catch {
    // Fire-and-forget: failure keeps "New Chat" title
  }
}
