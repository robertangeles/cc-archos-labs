"use client";

import { useState } from "react";
import {
  Plus,
  Search,
  MessageSquare,
  Sparkles,
  GitBranch,
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ChatConversation } from "@/hooks/use-chat";

interface ChatSidebarProps {
  conversations: ChatConversation[];
  activeId?: string;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onSearch: (query: string) => void;
  searchResults?: Array<{ id: string; title: string; snippet?: string }>;
  mobile?: boolean;
  onClose?: () => void;
}

export function ChatSidebar({
  conversations,
  activeId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onSearch,
  searchResults,
  mobile,
  onClose,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  function handleSearch(q: string) {
    setSearchQuery(q);
    onSearch(q);
  }

  const displayList = searchQuery && searchResults ? searchResults : null;

  return (
    <div
      className={`flex h-full flex-col bg-neutral-900 ${
        mobile ? "w-full" : "w-72 border-r border-neutral-800"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 p-3">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
        {mobile && onClose && (
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="border-b border-neutral-800 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent text-sm text-neutral-200 placeholder-neutral-500 outline-none"
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Search results */}
        {displayList && (
          <div className="p-2">
            <p className="px-2 pb-1 text-xs font-medium text-neutral-500">
              Search results
            </p>
            {displayList.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-neutral-600">
                No conversations matching &ldquo;{searchQuery}&rdquo;
              </p>
            )}
            {displayList.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelectConversation(r.id);
                  setSearchQuery("");
                }}
                className="w-full rounded-lg px-2 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800"
              >
                <span className="block truncate">{r.title}</span>
                {r.snippet && (
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">
                    {r.snippet}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Recent conversations */}
        {!displayList && (
          <div className="p-2">
            <p className="px-2 pb-1 text-xs font-medium text-neutral-500">
              Recent
            </p>
            {conversations.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-neutral-600">
                No chats yet. Start one.
              </p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg px-2 py-2 ${
                  c.id === activeId
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-300 hover:bg-neutral-800/50"
                }`}
              >
                <button
                  onClick={() => onSelectConversation(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                  <span className="truncate text-sm">{c.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                  className="shrink-0 p-1 text-neutral-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Navigation sections */}
        <div className="border-t border-neutral-800 p-2">
          <CollapsibleSection
            label="Skills"
            icon={Sparkles}
            open={skillsOpen}
            onToggle={() => setSkillsOpen(!skillsOpen)}
          >
            <Link
              href="/account/skills"
              className="block rounded-lg px-8 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              View all skills
            </Link>
          </CollapsibleSection>

          <CollapsibleSection
            label="Workflows"
            icon={GitBranch}
            open={workflowsOpen}
            onToggle={() => setWorkflowsOpen(!workflowsOpen)}
          >
            <Link
              href="/account/workflows"
              className="block rounded-lg px-8 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              View all workflows
            </Link>
          </CollapsibleSection>

          <CollapsibleSection
            label="History"
            icon={Clock}
            open={historyOpen}
            onToggle={() => setHistoryOpen(!historyOpen)}
          >
            <Link
              href="/account/history"
              className="block rounded-lg px-8 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              View activity history
            </Link>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  label,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && children}
    </div>
  );
}
