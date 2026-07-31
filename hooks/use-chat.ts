"use client";

import { useState, useCallback, useRef } from "react";
import { parseStream, type SourceRef } from "@/lib/chat/stream-events";

export interface ChatConversation {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  contentType?: string;
  model?: string | null;
  isInterrupted?: boolean;
  /** Works this answer was grounded in. Absent on user messages, ungrounded
   *  answers, and every message written before migration 0041. */
  sources?: SourceRef[];
  createdAt: string;
}

interface UseChatOptions {
  defaultModel: string;
}

export function useChat({ defaultModel }: UseChatOptions) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  // Latest tool-loop progress label, or null. Display-only: a tool turn's
  // answer is non-streamed, so this is the sole feedback during the wait.
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  // Works the in-flight answer is grounded in. Rendered alongside the streaming
  // text so the strip appears with the answer rather than after it.
  const [streamingSources, setStreamingSources] = useState<SourceRef[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Every transient per-answer field, cleared together. Sources were originally
  // reset only on the success path, so an aborted turn or a conversation switch
  // left the PREVIOUS answer's citations on screen — attribution pointing at
  // the wrong answer, which is worse than no attribution at all.
  const resetStreamingState = useCallback(() => {
    setStreamingContent("");
    setToolProgress(null);
    setStreamingSources([]);
  }, []);

  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/chat/conversations");
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setActiveConversation(data.conversation);
      setMessages(data.messages);
      setHasMore(data.hasMore);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!activeConversation || !messages.length) return;
    const oldest = messages[0]?.createdAt;
    if (!oldest) return;

    const res = await fetch(
      `/api/chat/conversations/${activeConversation.id}?before=${oldest}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setMessages((prev) => [...data.messages, ...prev]);
    setHasMore(data.hasMore);
  }, [activeConversation, messages]);

  const newChat = useCallback(
    async (systemPrompt?: string) => {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: defaultModel, systemPrompt }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setActiveConversation(data.conversation);
      setMessages([]);
      setHasMore(false);
      setConversations((prev) => [data.conversation, ...prev]);
      return data.conversation as ChatConversation;
    },
    [defaultModel],
  );

  const sendMessage = useCallback(
    async (content: string, model?: string, webSearch?: boolean, imageGen?: { aspectRatio?: string; imageSize?: string }) => {
      if (isSending) return;
      let convoId = activeConversation?.id;

      if (!convoId) {
        const created = await newChat();
        if (!created) return;
        convoId = created.id;
      }

      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      // Clear BEFORE the new answer starts, or the previous answer's citation
      // strip sits next to the new streaming text until this turn's sources
      // event arrives.
      resetStreamingState();

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const res = await fetch(
          `/api/chat/conversations/${convoId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, model, webSearch, imageGen }),
            signal: abortController.signal,
          },
        );

        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: "Request failed" }));
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: error.error ?? "Something went wrong.",
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          return;
        }

        if (!res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          if (!imageGen) {
            // The stream carries delimiter-wrapped events ahead of the answer:
            // which works it drew on, and (for a tool turn) what it is doing.
            // Both are display metadata and must stay out of the message body.
            const parsed = parseStream(accumulated);
            setToolProgress(parsed.progress);
            if (parsed.sources.length > 0) setStreamingSources(parsed.sources);
            setStreamingContent(parsed.content);
          }
        }

        const finalParsed = parseStream(accumulated);
        let msgContent = finalParsed.content;
        let msgContentType: string | undefined;

        if (imageGen && accumulated) {
          try {
            const parsed = JSON.parse(accumulated);
            msgContent = parsed.imageUrl ?? parsed.text ?? accumulated;
            msgContentType = parsed.contentType;
          } catch {
            // not JSON, use raw
          }
        }

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: msgContent,
          contentType: msgContentType,
          sources: finalParsed.sources.length > 0 ? finalParsed.sources : undefined,
          model: activeConversation?.model ?? defaultModel,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        resetStreamingState();
        refreshConversations();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          if (streamingContent) {
            const partial: ChatMessage = {
              id: `partial-${Date.now()}`,
              role: "assistant",
              content: streamingContent,
              isInterrupted: true,
              // An interrupted answer was still grounded in these works — the
              // citation is as true of the partial text as of the whole.
              sources: streamingSources.length > 0 ? streamingSources : undefined,
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, partial]);
          }
          // Reset whether or not there was partial content: an abort before the
          // first token still has the sources preamble on screen.
          resetStreamingState();
        }
      } finally {
        setIsSending(false);
        abortRef.current = null;
      }
    },
    [activeConversation, isSending, defaultModel, newChat, refreshConversations, streamingContent, streamingSources, resetStreamingState],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversation?.id === id) {
        setActiveConversation(null);
        setMessages([]);
      }
    },
    [activeConversation],
  );

  const clearActive = useCallback(() => {
    setActiveConversation(null);
    setMessages([]);
    setHasMore(false);
    resetStreamingState();
  }, [resetStreamingState]);

  return {
    conversations,
    activeConversation,
    messages,
    hasMore,
    isLoading,
    isSending,
    streamingContent,
    toolProgress,
    streamingSources,
    refreshConversations,
    loadConversation,
    loadMore,
    newChat,
    sendMessage,
    deleteConversation,
    clearActive,
  };
}
