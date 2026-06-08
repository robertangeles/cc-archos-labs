"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { useChat } from "@/hooks/use-chat";
import { ChatMessage } from "@/components/chat/chat-message";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatSkillForm } from "@/components/chat/chat-skill-form";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

const THINKING_VERBS = [
  "Reasoning",
  "Analyzing",
  "Composing",
  "Reflecting",
  "Thinking",
  "Processing",
  "Drafting",
  "Considering",
  "Synthesizing",
  "Formulating",
];

interface ChatWorkspaceProps {
  displayName: string | null;
  userId: string;
}

export function ChatWorkspace({ displayName }: ChatWorkspaceProps) {
  const {
    conversations,
    activeConversation,
    messages,
    hasMore,
    isSending,
    streamingContent,
    refreshConversations,
    loadConversation,
    loadMore,
    sendMessage,
    deleteConversation,
    clearActive,
  } = useChat({ defaultModel: DEFAULT_MODEL });

  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; title: string; snippet?: string }>
  >([]);
  const [pendingSkill, setPendingSkill] = useState<{
    skillId: string;
    skillName: string;
    inputs: Array<{ key: string; label: string; type: string; isRequired: boolean; defaultValue: string | null }>;
  } | null>(null);
  const [isExecutingSkill, setIsExecutingSkill] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [thinkingVerb, setThinkingVerb] = useState(THINKING_VERBS[0]);

  useEffect(() => {
    if (!isSending) return;
    const interval = setInterval(() => {
      setThinkingVerb(THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]);
    }, 2000);
    return () => clearInterval(interval);
  }, [isSending]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  async function handleSend() {
    if (!input.trim() || isSending) return;
    const text = input;

    if (text.startsWith("/run")) {
      setInput("");
      try {
        const res = await fetch("/api/chat/slash-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Skill not found" }));
          sendMessage(err.error ?? "Skill not found. Type /run to see available skills.");
          return;
        }
        const cmd = await res.json();
        if (cmd.inputs.length === 0) {
          handleExecuteSkill(cmd.skillId, {});
        } else {
          setPendingSkill(cmd);
        }
      } catch {
        sendMessage("Failed to parse command.");
      }
      return;
    }

    setInput("");
    sendMessage(text, selectedModel);
  }

  async function handleExecuteSkill(skillId: string, inputValues: Record<string, string>) {
    setIsExecutingSkill(true);
    setPendingSkill(null);
    try {
      const res = await fetch(`/api/skills/${skillId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: inputValues }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Skill execution failed" }));
        sendMessage(`Skill execution failed: ${err.error ?? "Unknown error"}`);
        return;
      }
      const data = await res.json();
      const resultText = data.result ?? data.output ?? JSON.stringify(data);
      sendMessage(`/run result:\n\n${resultText}`);
    } catch {
      sendMessage("Skill execution failed. Try again.");
    } finally {
      setIsExecutingSkill(false);
    }
  }

  function handleSuggestion(text: string) {
    setInput("");
    sendMessage(text, selectedModel);
  }

  function handleSelectConversation(id: string) {
    loadConversation(id);
    setDrawerOpen(false);
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/chat/conversations/search?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSearchResults(data.results);
    } catch {
      setSearchResults([]);
    }
  }

  function handleNewChat() {
    clearActive();
    setDrawerOpen(false);
  }

  const showEmpty = !activeConversation && messages.length === 0;

  return (
    <div className="flex h-[calc(100dvh-72px)] overflow-hidden bg-neutral-950">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <ChatSidebar
          conversations={conversations}
          activeId={activeConversation?.id}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={deleteConversation}
          onSearch={handleSearch}
          searchResults={searchResults}
        />
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-80">
            <ChatSidebar
              conversations={conversations}
              activeId={activeConversation?.id}
              onNewChat={handleNewChat}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={deleteConversation}
              onSearch={handleSearch}
              searchResults={searchResults}
              mobile
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col bg-neutral-950">
        {/* Mobile header */}
        <div className="flex items-center gap-3 border-b border-neutral-800/50 bg-neutral-950 px-4 py-2.5 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1 text-neutral-500 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate text-[13px] font-medium text-neutral-300">
            {activeConversation?.title ?? "New Chat"}
          </span>
        </div>

        {/* Messages or empty state */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          {showEmpty ? (
            <ChatEmptyState
              displayName={displayName}
              onSuggestion={handleSuggestion}
            />
          ) : (
            <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
              {hasMore && (
                <button
                  onClick={loadMore}
                  className="mx-auto mb-6 block rounded-full border border-neutral-800 px-4 py-1.5 text-[12px] text-neutral-500 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-300"
                >
                  Load earlier messages
                </button>
              )}
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  model={msg.model}
                  isInterrupted={msg.isInterrupted}
                />
              ))}
              {streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={streamingContent}
                  model={activeConversation?.model}
                  isStreaming
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Pending skill form */}
        {pendingSkill && (
          <div className="border-t border-neutral-800/40 px-4">
            <div className="mx-auto max-w-3xl">
              <ChatSkillForm
                skillName={pendingSkill.skillName}
                skillId={pendingSkill.skillId}
                inputs={pendingSkill.inputs}
                onExecute={handleExecuteSkill}
                onCancel={() => setPendingSkill(null)}
                isExecuting={isExecutingSkill}
              />
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="mx-auto max-w-3xl">
            {isSending && (
              <div className="mb-2 flex items-center gap-2">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                <p className="text-[12px] text-ink-subtle">
                  {thinkingVerb}...
                </p>
              </div>
            )}
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={isSending || isExecutingSkill}
              placeholder={
                showEmpty
                  ? "How can I help you today?"
                  : "Message..."
              }
              modelPicker={
                <ChatModelPicker
                  value={selectedModel}
                  onChange={setSelectedModel}
                />
              }
              onToolSelect={(tool) => {
                if (tool === "run-skill") {
                  setInput("/run ");
                } else if (tool === "research") {
                  setInput("Research: ");
                } else if (tool === "web-search") {
                  setInput("Search the web for: ");
                }
              }}
            />
            <p className="mt-2 text-center text-[11px] text-neutral-600">
              AI responses may be inaccurate. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
