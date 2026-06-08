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

  function handleSearch(q: string) {
    setSearchQuery(q);
    onSearch(q);
  }

  const displayList = searchQuery && searchResults ? searchResults : null;

  return (
    <div
      className={`flex h-full flex-col border-r border-neutral-800/60 bg-neutral-950 ${
        mobile ? "w-full" : "w-[260px]"
      }`}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-[14px] font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
        {mobile && onClose && (
          <button onClick={onClose} className="ml-2 p-1 text-neutral-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-800/40 bg-neutral-900/50 px-2.5 py-1.5">
          <Search className="h-3 w-3 text-neutral-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent text-[15px] text-neutral-300 placeholder-neutral-600 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {displayList && (
          <div className="py-1">
            <SectionLabel>Search results</SectionLabel>
            {displayList.length === 0 && (
              <p className="px-2 py-6 text-center text-[12px] text-neutral-600">
                No matches for &ldquo;{searchQuery}&rdquo;
              </p>
            )}
            {displayList.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelectConversation(r.id);
                  setSearchQuery("");
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-[15px] text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
              >
                <span className="block truncate">{r.title}</span>
              </button>
            ))}
          </div>
        )}

        {!displayList && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {conversations.length === 0 && (
              <p className="px-2 py-6 text-center text-[14px] text-neutral-600">
                No chats yet. Start one.
              </p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg px-2 py-1.5 ${
                  c.id === activeId
                    ? "bg-primary/10 text-primary"
                    : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200"
                }`}
              >
                <button
                  onClick={() => onSelectConversation(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <MessageSquare className="h-3 w-3 shrink-0 text-neutral-600" />
                  <span className="truncate text-[15px]">{c.title}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                  className="shrink-0 p-0.5 text-neutral-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Direct navigation links */}
      <div className="border-t border-neutral-800/40 px-2 py-3">
        <NavLink href="/account/skills" icon={Sparkles} label="Skills" />
        <NavLink href="/account/workflows" icon={GitBranch} label="Workflows" />
        <NavLink href="/account/history" icon={Clock} label="History" />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-[13px] font-medium uppercase tracking-wider text-neutral-600">
      {children}
    </p>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] text-neutral-400 transition-colors hover:bg-neutral-800/40 hover:text-neutral-200"
    >
      <Icon className="h-4 w-4 text-neutral-500" />
      {label}
    </Link>
  );
}
