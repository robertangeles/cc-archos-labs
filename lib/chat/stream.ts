import "server-only";
import {
  OPENROUTER_URL,
  resolveLlmConfig,
  buildAuthHeaders,
} from "../llm/config";
import * as chatService from "./service";
import { getChatPrompt } from "./prompt-config";
import { getEnabledRules } from "../rules/service";
import { vectorSearch } from "../knowledge/search";
import { recallMemories, formatRecallContext } from "../brain/recall";
import { extractMemories } from "../brain/extract";
import { loadConversationDocuments } from "./attachments/service";
import { getModelContextWindow, fitContext } from "./attachments/budget";
import { logAttachmentEvent } from "./attachments/observability";

interface StreamMessageArgs {
  conversationId: string;
  userId: string;
  userContent: string;
  modelOverride?: string;
  systemPrompt?: string | null;
  signal?: AbortSignal;
  webSearch?: boolean;
  imageGen?: {
    aspectRatio?: string;
    imageSize?: string;
  };
}

export async function streamMessage(args: StreamMessageArgs): Promise<{
  stream: ReadableStream<Uint8Array>;
  cleanup: () => Promise<void>;
}> {
  const { apiKey, modelId } = await resolveLlmConfig(args.modelOverride);

  await chatService.saveMessage(
    args.conversationId,
    "user",
    args.userContent,
  );

  const corePromptConfig = await getChatPrompt();
  const corePrompt = corePromptConfig.systemPrompt;

  let ragContext = "";
  try {
    const results = await vectorSearch(args.userContent, undefined, 5);
    if (results.length > 0) {
      const chunks = results
        .filter((r) => r.similarity > 0.3)
        .map((r) => `[${r.title}]\n${r.content}`)
        .join("\n\n---\n\n");
      if (chunks) {
        ragContext =
          "Use the following knowledge base context to inform your response. " +
          "Cite the source title when relevant. If the context doesn't help, ignore it.\n\n" +
          chunks;
      }
    }
  } catch {
    // Knowledge search unavailable — continue without RAG
  }

  let brainContext = "";
  try {
    const recall = await recallMemories(args.userId, args.userContent);
    if (recall.source === "brain" && recall.memories.length > 0) {
      brainContext = formatRecallContext(recall.memories);
    }
  } catch {
    // Brain recall failed — continue without memory enrichment
  }

  const rules = await getEnabledRules(args.userId);
  const rulesBlock = rules.length > 0
    ? rules.map((r) => r.content).join("\n\n")
    : "";

  const systemParts = [corePrompt, brainContext, ragContext, args.systemPrompt ?? "", rulesBlock].filter(Boolean);
  const systemText = systemParts.join("\n\n");

  // Attached documents (Attach Files). Graceful degrade: a missing table (deploy
  // before PROD migrate) or a DB blip must NEVER abort the stream — mirror how
  // ragContext/brainContext fail soft above.
  let attachedDocs: Array<{ fileName: string; extractedText: string }> = [];
  try {
    attachedDocs = await loadConversationDocuments(
      args.conversationId,
      args.userId,
    );
  } catch {
    // No attachments on failure — chat continues normally.
  }

  const historyRaw = await loadConversationHistory(
    args.conversationId,
    args.userId,
  );

  // Fit system + attachments + history inside the CONFIGURED model's window
  // (total-overflow guard). Trims oldest history and omits low-priority docs.
  const modelWindow = await getModelContextWindow(modelId);
  const fit = fitContext({
    windowTokens: modelWindow,
    systemText,
    attachments: attachedDocs,
    history: historyRaw,
  });
  if (fit.omittedDocNames.length > 0) {
    logAttachmentEvent({
      event: "budget_omitted",
      conversationId: args.conversationId,
      userId: args.userId,
      omittedCount: fit.omittedDocNames.length,
    });
  }

  const finalSystemContent = fit.attachmentBlock
    ? systemText
      ? `${systemText}\n\n${fit.attachmentBlock}`
      : fit.attachmentBlock
    : systemText;
  const systemMessage = finalSystemContent
    ? [{ role: "system" as const, content: finalSystemContent }]
    : [];

  const priorMessages = fit.history;

  // Web search mode: use Responses API for url_citation annotations
  if (args.webSearch) {
    const responsesUrl = OPENROUTER_URL.replace("/chat/completions", "/responses");
    const inputMessages: Array<Record<string, unknown>> = [];

    if (systemMessage.length > 0) {
      inputMessages.push({
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: systemMessage[0].content }],
      });
    }
    for (const msg of priorMessages) {
      inputMessages.push({
        type: "message",
        role: msg.role,
        content: [{
          type: msg.role === "assistant" ? "output_text" : "input_text",
          text: msg.content,
        }],
      });
    }

    const responsesRes = await fetch(responsesUrl, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        input: inputMessages,
        tools: [{ type: "web_search_preview" }],
      }),
      signal: args.signal,
    });

    if (!responsesRes.ok) {
      const body = await responsesRes.text().catch(() => "");
      const status = responsesRes.status;
      if (status === 429) throw new StreamError("Model is busy. Try again in a moment.", 429);
      if (status >= 500) throw new StreamError("AI service temporarily unavailable.", 502);
      throw new StreamError(`OpenRouter error: ${body.slice(0, 200)}`, status);
    }

    const json = await responsesRes.json();
    const outputs: Array<{ type: string; content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }> }> =
      json.output ?? [];
    const messageOutput = outputs.find((o) => o.type === "message");
    const textContent = messageOutput?.content?.find((c) => c.type === "output_text");
    let content = textContent?.text ?? "";
    const tokens = json.usage?.output_tokens ?? 0;

    const citationUrls = extractCitationUrls(textContent?.annotations ?? []);
    if (citationUrls.length > 0) {
      content += formatCitationBlock(citationUrls);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(content));
        controller.close();
      },
    });

    const cleanup = async () => {
      if (content.length > 0) {
        await chatService.saveMessage(
          args.conversationId,
          "assistant",
          content,
          modelId,
          tokens,
          false,
        );
        extractMemories(args.userId, args.userContent, content).catch(() => {});
      }
    };

    return { stream, cleanup };
  }

  // Perplexity: non-streaming to get citation annotations
  if (modelId.startsWith("perplexity/")) {
    const perplexityRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        stream: false,
        messages: [...systemMessage, ...priorMessages],
      }),
      signal: args.signal,
    });

    if (!perplexityRes.ok) {
      const body = await perplexityRes.text().catch(() => "");
      const status = perplexityRes.status;
      if (status === 429) throw new StreamError("Model is busy. Try again in a moment.", 429);
      if (status >= 500) throw new StreamError("AI service temporarily unavailable.", 502);
      throw new StreamError(`OpenRouter error: ${body.slice(0, 200)}`, status);
    }

    const json = await perplexityRes.json();
    const message = json.choices?.[0]?.message;
    let content: string = message?.content ?? "";
    const tokens = json.usage?.completion_tokens ?? 0;

    const annotations: Array<Record<string, unknown>> = message?.annotations ?? [];
    const citationUrls = extractCitationUrls(annotations);
    if (citationUrls.length > 0) {
      content = inlineCitationLinks(content, citationUrls);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(content));
        controller.close();
      },
    });

    const cleanup = async () => {
      if (content.length > 0) {
        await chatService.saveMessage(
          args.conversationId,
          "assistant",
          content,
          modelId,
          tokens,
          false,
        );
        extractMemories(args.userId, args.userContent, content).catch(() => {});
      }
    };

    return { stream, cleanup };
  }

  // Image generation: non-streaming, send ONLY the user's prompt
  // (system prompts and chat history degrade image model output)
  if (args.imageGen) {
    const imageRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        stream: false,
        messages: [{
          role: "user",
          content: /^(create|generate|draw|make|design|paint|sketch|illustrate)\b/i.test(args.userContent.trim())
            ? args.userContent
            : `Generate an image: ${args.userContent}`,
        }],
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio: args.imageGen.aspectRatio ?? "2:3",
          image_size: args.imageGen.imageSize ?? "2K",
        },
      }),
      signal: args.signal,
    });

    if (!imageRes.ok) {
      const body = await imageRes.text().catch(() => "");
      const status = imageRes.status;
      if (status === 429) throw new StreamError("Model is busy. Try again in a moment.", 429);
      if (status >= 500) throw new StreamError("AI service temporarily unavailable.", 502);
      throw new StreamError(`Image generation failed: ${body.slice(0, 200)}`, status);
    }

    const json = await imageRes.json();
    const msg = json.choices?.[0]?.message;
    const tokens = json.usage?.completion_tokens ?? 0;

    const { imageUrl, textContent, contentType } = extractImageFromResponse(msg);

    const responsePayload = JSON.stringify({ imageUrl, text: textContent, contentType });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(responsePayload));
        controller.close();
      },
    });

    const cleanup = async () => {
      if (imageUrl) {
        await chatService.saveMessage(
          args.conversationId, "assistant", imageUrl,
          modelId, tokens, false, contentType as "image_url" | "image_base64",
        );
      } else if (textContent) {
        await chatService.saveMessage(
          args.conversationId, "assistant", textContent,
          modelId, tokens, false, "text",
        );
      }
    };

    return { stream, cleanup };
  }

  // Standard models: streaming via chat completions
  const openRouterResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({
      model: modelId,
      stream: true,
      messages: [...systemMessage, ...priorMessages],
    }),
    signal: args.signal,
  });

  if (!openRouterResponse.ok) {
    const body = await openRouterResponse.text().catch(() => "");
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = openRouterResponse.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
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
      if (!aborted) {
        extractMemories(args.userId, args.userContent, buffer).catch(() => {});
      }
    }
  };

  return { stream, cleanup };
}

function extractImageFromResponse(msg: Record<string, unknown> | undefined): {
  imageUrl: string | null;
  textContent: string | null;
  contentType: string;
} {
  if (!msg) return { imageUrl: null, textContent: null, contentType: "text" };

  const images = msg.images as Array<{ image_url?: { url?: string } }> | undefined;
  if (images && images.length > 0) {
    const url = images[0]?.image_url?.url;
    if (url) {
      const ct = url.startsWith("data:") ? "image_base64" : "image_url";
      const text = typeof msg.content === "string" ? msg.content : null;
      return { imageUrl: url, textContent: text, contentType: ct };
    }
  }

  const content = msg.content;
  if (Array.isArray(content)) {
    let imageUrl: string | null = null;
    let contentType = "text";
    const textParts: string[] = [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
      } else if (part.type === "image_url") {
        const u = (part.image_url as Record<string, string>)?.url;
        if (u) {
          imageUrl = u;
          contentType = u.startsWith("data:") ? "image_base64" : "image_url";
        }
      } else if ((part as Record<string, unknown>).inline_data) {
        const inline = (part as Record<string, Record<string, string>>).inline_data;
        imageUrl = `data:${inline.mime_type || "image/png"};base64,${inline.data}`;
        contentType = "image_base64";
      }
    }
    return { imageUrl, textContent: textParts.join("\n") || null, contentType };
  }

  if (typeof content === "string") {
    const match = content.match(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/);
    if (match) return { imageUrl: match[0], textContent: null, contentType: "image_base64" };
    return { imageUrl: null, textContent: content || null, contentType: "text" };
  }

  return { imageUrl: null, textContent: null, contentType: "text" };
}

async function loadConversationHistory(conversationId: string, userId: string) {
  const db = (await import("../db")).getDb();
  const { message: messageTable, conversation: convTable } = await import("../db/schema");
  const [owner] = await db
    .select({ id: convTable.id })
    .from(convTable)
    .where(and(eq(convTable.id, conversationId), eq(convTable.userId, userId)))
    .limit(1);
  if (!owner) return [];
  const msgs = await db
    .select({ role: messageTable.role, content: messageTable.content })
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .orderBy(messageTable.createdAt);
  return msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

import { and, eq } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCitationUrls(annotations: Array<Record<string, any>>): string[] {
  return [...new Set(
    annotations
      .filter((a) => a.type === "url_citation")
      .map((a) => a.url_citation?.url ?? a.url)
      .filter(Boolean),
  )];
}

function inlineCitationLinks(content: string, urls: string[]): string {
  return content.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num, 10) - 1;
    if (index >= 0 && index < urls.length) {
      return `[[${num}]](${urls[index]})`;
    }
    return match;
  });
}

function formatCitationBlock(urls: string[]): string {
  const lines = urls.map((url, i) => {
    let domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch { /* use raw url as label */ }
    return `${i + 1}. [${domain}](${url})`;
  });
  return `\n\n---\n**Sources**\n${lines.join("\n")}`;
}

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
  userId: string,
  firstUserMessage: string,
): Promise<void> {
  try {
    const { apiKey, modelId } = await resolveLlmConfig();
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        max_tokens: 20,
        messages: [
          {
            role: "system",
            content:
              "Generate a short title (3-6 words) for a conversation that starts with the user message below. Return ONLY the title text. No quotes, no punctuation, no explanation.",
          },
          { role: "user", content: firstUserMessage.slice(0, 500) },
        ],
      }),
    });

    if (!response.ok) return;

    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const title = raw.replace(/^["']|["']$/g, "").trim();
    if (!title || title.length > 80) return;

    const { getDb } = await import("../db");
    const { conversation } = await import("../db/schema");
    const db = getDb();
    await db
      .update(conversation)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)));
  } catch {
    // Fire-and-forget: failure keeps "New Chat" title
  }
}
