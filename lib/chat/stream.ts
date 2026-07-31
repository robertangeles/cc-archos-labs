import "server-only";
import {
  OPENROUTER_URL,
  resolveLlmConfig,
  buildAuthHeaders,
} from "../llm/config";
import * as chatService from "./service";
import { getChatPrompt } from "./prompt-config";
import {
  audienceFor,
  coverageNotice,
  ragInstruction,
  resolveSourceBlock,
} from "./prompt-config-shared";
import { getEnabledRules } from "../rules/service";
import { retrieve } from "../knowledge/retrieve";
import { encodeEvent, stripDelimiters } from "./stream-events";
import {
  logRetrievalEvent,
  safeReason as safeRetrievalReason,
} from "../knowledge/observability";
import type { SearchResult } from "../knowledge/search";
import { recallMemories, formatRecallContext } from "../brain/recall";
import { getMemoryStatusFromDb } from "../brain/memory";
import { extractMemories } from "../brain/extract";
import { buildWorkspaceContext } from "./workspace-context";
import {
  isWorkspaceToolsEnabled,
  resolveToolOrgId,
  runWorkspaceToolTurn,
} from "./workspace-tools";
import type { ChatMessage } from "./tool-loop";
import { loadConversationDocuments } from "./attachments/service";
import { getModelContextWindow, fitContext } from "./attachments/budget";
import { logAttachmentEvent } from "./attachments/observability";

// Injected when the brain has no memories for this user (or recall failed).
// Deliberately NOT titled "## Brain Memory" — the system prompt ties that
// heading to "you know this user, treat the notes as true", which is the
// opposite of what we want here. A blunt present-tense "no record" statement
// adjacent to the user's turn is what stops a weaker model from inventing a
// persona when asked "do you remember me?".
const EMPTY_BRAIN_NOTICE =
  "## Memory check\n" +
  "There are NO saved notes about this user. You have no prior record of who " +
  "they are — no name, company, role, industry, location, or projects. Treat " +
  "this as your first meeting.\n\n" +
  'If they ask "do you remember me?", "who am I?", or anything about ' +
  "themselves, say plainly that you don't have anything on them yet and invite " +
  "them to tell you about themselves. NEVER invent, guess, or state any " +
  "personal detail about this user. Fabricating an identity is a critical failure.";

// Defence in depth: on a client turn the excerpts arrive UNLABELLED. The
// instruction not to name a source is a rule the model follows; withholding
// the titles is a fact it cannot get around. Belt and braces, because the
// titles are the asset being protected.
function formatChunks(
  chunks: SearchResult[],
  audience: "internal" | "client",
): string {
  return chunks
    .map((c) => (audience === "internal" ? `[${c.title}]\n${c.content}` : c.content))
    .join("\n\n---\n\n");
}

interface StreamMessageArgs {
  conversationId: string;
  userId: string;
  /**
   * The caller's `users.role`. Decides whether this turn may name the library
   * (see audienceFor). Omitted resolves to the `client` audience — attribution
   * is opt-in, never inherited.
   */
  userRole?: string | null;
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

  // Which source-handling regime governs this turn. `internal` (admin) may name
  // the library; `client` may not. Everything downstream that touches source
  // material — the excerpt labels, the RAG instruction, the appended source
  // block — reads from this one value so they can never disagree with one
  // another the way stream.ts and the stored prompt did before the split.
  const audience = audienceFor(args.userRole);
  const sourceBlock = resolveSourceBlock(corePromptConfig, audience);

  // History first — retrieval needs it to resolve what the latest message
  // refers to ("what about the governance angle?"). Drop the turn we just
  // saved; it is passed separately as the thing being rewritten.
  const historyRaw = await loadConversationHistory(
    args.conversationId,
    args.userId,
  );
  const priorTurns = historyRaw.slice(0, -1);

  // Everything below is independent, and until now was awaited one after
  // another: recall, then workspace, then rules, then retrieval. Four
  // round-trips in series for no reason. Running them together is what pays
  // for retrieval's decompose call — the added latency hides inside waits we
  // were already doing.
  const [retrieval, brainContext, workspaceContext, rulesBlock] =
    await Promise.all([
      retrieveLibrary(),
      buildBrainContext(),
      buildWorkspaceContext(args.userId),
      buildRulesBlock(),
    ]);

  // Four distinct states, never conflated (see coverageNotice):
  //   grounded    enough material reached the model — inject it
  //   thin        some material, below the coverage gate — inject it, caveated
  //   uncovered   we looked and there is nothing — say so, inject nothing
  //   degraded    we could not look — a service failure, worded differently
  // The citation strip is INTERNAL ONLY. Naming a work to a client turn is the
  // exact disclosure the protection block forbids, and a visible source list is
  // a louder version of it than anything the model could say in prose.
  const citedSources = audience === "internal" ? retrieval.sources : [];

  const ragContext = retrieval.degraded
    ? coverageNotice("degraded", audience)
    : retrieval.chunks.length && retrieval.covered
      ? `${ragInstruction(audience)}\n\n${formatChunks(retrieval.chunks, audience)}`
      : retrieval.chunks.length
        ? // FOUR states, not three. Material cleared the floor but not enough to
          // call the question covered: inject what there is with the "thin"
          // caveat, NOT the "uncovered" one. Uncovered copy says nothing was
          // retrieved, which is false when excerpts sit directly above it.
          `${ragInstruction(audience)}\n\n${formatChunks(retrieval.chunks, audience)}\n\n${coverageNotice("thin", audience)}`
        : coverageNotice("uncovered", audience);

  async function retrieveLibrary() {
    try {
      return await retrieve({
        turn: args.userContent,
        history: priorTurns,
        apiKey,
        audience,
        signal: args.signal,
      });
    } catch (err) {
      // retrieve() is written never to throw; this is belt and braces so a
      // future edit inside it can never take the whole turn down.
      logRetrievalEvent({
        event: "retrieval",
        audience,
        strategy: "fanout",
        subQueries: 0,
        domains: [],
        paths: [],
        candidates: 0,
        droppedBelowFloor: 0,
        chunks: 0,
        distinctSources: 0,
        sources: [],
        topScore: null,
        medianScore: null,
        ms: 0,
        decomposeMs: null,
        degraded: true,
        reason: safeRetrievalReason(err),
      });
      return {
        chunks: [],
        sources: [],
        distinctSources: 0,
        aboveFloor: 0,
        covered: false,
        degraded: true,
      };
    }
  }

  // Brain recall. Three cases:
  //  1. relevant memories → inject them.
  //  2. brain is genuinely EMPTY → inject an explicit "no record" notice. The
  //     absence of a memory block is not a signal a weaker model reads, so on an
  //     empty brain it fabricates a plausible user ("You're Alex Chen, founder
  //     of ..."). Stating the empty state in the present tense, adjacent to the
  //     question, is what stops the confabulation (tests/e2e/brain-no-fabrication).
  //  3. brain has notes but NONE matched this query → inject nothing. Recall is
  //     relevance-ranked, so an empty result for one query does NOT mean an empty
  //     brain; claiming "no record" here would make Metis deny a user it knows.
  async function buildBrainContext(): Promise<string> {
    try {
      const recall = await recallMemories(args.userId, args.userContent);
      if (recall.source === "brain" && recall.memories.length > 0) {
        return formatRecallContext(recall.memories);
      }
      const status = await getMemoryStatusFromDb(args.userId);
      return status.hasMemory ? "" : EMPTY_BRAIN_NOTICE;
    } catch {
      // Recall/status unavailable — continue without a memory block.
      return "";
    }
  }

  async function buildRulesBlock(): Promise<string> {
    const rules = await getEnabledRules(args.userId);
    return rules.length > 0 ? rules.map((r) => r.content).join("\n\n") : "";
  }

  // sourceBlock sits directly after the core prompt so the source regime is
  // established before any retrieved material appears. It is "" for a stored
  // prompt that predates the split (that row still carries its rules inline).
  const systemParts = [corePrompt, sourceBlock, brainContext, workspaceContext, ragContext, args.systemPrompt ?? "", rulesBlock].filter(Boolean);
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
        extractMemories(args.userId, args.userContent, args.conversationId).catch(() => {});
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
        extractMemories(args.userId, args.userContent, args.conversationId).catch(() => {});
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

  // Tool loop (C2): flag-gated. When on, the model may call allowlisted tools
  // mid-answer — search_library to chase a thread into the practice library,
  // plus the org-scoped workspace tools when an org resolves. A
  // tool-using turn's final answer is produced non-streamed, so it ships as a
  // single chunk (like web search). On any failure or empty answer, fall through
  // to normal streaming (ungrounded). Only reached for standard models — the
  // web-search / perplexity / image branches above already returned.
  if (isWorkspaceToolsEnabled()) {
    // NOT gated on the org resolving. It used to be, and that silently disabled
    // the one capability the loop exists for: search_library reads a shared
    // shelf with no tenant data, so the guard protecting the other four tools
    // has nothing to protect there. Gating is now per-tool (toolsFor), and the
    // org-scoped four hard-fail on a null orgId.
    const toolOrgId = await resolveToolOrgId(args.userId);
    {
      let toolContent = "";
      // Progress events are buffered here and replayed into the stream ahead of
      // the answer. The loop's answer is non-streamed, so this is the only
      // feedback the user gets during a wait that can reach 20 seconds.
      const progressLabels: string[] = [];
      try {
        toolContent = await runWorkspaceToolTurn({
          onProgress: (pr) => progressLabels.push(pr.label),
          messages: [...systemMessage, ...priorMessages] as ChatMessage[],
          orgId: toolOrgId,
          audience,
          // Anything the pre-turn retrieval already showed the model. Seeing a
          // passage twice reads as two sources agreeing.
          seenChunkIds: new Set(retrieval.chunks.map((c) => c.chunkId)),
          modelId,
          apiKey,
          signal: args.signal,
        });
      } catch {
        toolContent = "";
      }
      if (toolContent) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (citedSources.length > 0) {
              controller.enqueue(
                encoder.encode(encodeEvent({ t: "s", sources: citedSources })),
              );
            }
            for (const label of progressLabels) {
              controller.enqueue(encoder.encode(encodeEvent({ t: "p", label })));
            }
            // Strip any delimiter the model itself produced, so an answer that
            // mentions a control character cannot be read as an event boundary.
            controller.enqueue(encoder.encode(stripDelimiters(toolContent)));
            controller.close();
          },
        });
        const cleanup = async () => {
          // toolContent only — progress events are display-only and must never
          // reach the stored message.
          await chatService.saveMessage(
            args.conversationId,
            "assistant",
            toolContent,
            modelId,
            0,
            false,
            undefined,
            citedSources,
          );
          extractMemories(
            args.userId,
            args.userContent,
            args.conversationId,
          ).catch(() => {});
        };
        return { stream, cleanup };
      }
    }
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

  const sourcesPreamble =
    citedSources.length > 0 ? encodeEvent({ t: "s", sources: citedSources }) : "";

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
      // Sources first, before any token: they are known the moment retrieval
      // finished, and the client needs them to render the strip alongside the
      // streaming answer rather than after it.
      if (sourcesPreamble) controller.enqueue(encoder.encode(sourcesPreamble));
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
        undefined,
        citedSources,
      );
      if (!aborted) {
        extractMemories(args.userId, args.userContent, args.conversationId).catch(() => {});
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
