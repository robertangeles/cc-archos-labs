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
      className={`flex h-full flex-col border-r border-neutral-800/60 bg-neutral-950 ${
        mobile ? "w-full" : "w-[260px]"
      }`}
    >
      {/* Brand header */}
      <div className="flex items-center gap-2 border-b border-neutral-800/40 px-3.5 py-3">
        <img
          src="/images/logo.png"
          alt=""
          width={24}
          height={24}
          className="h-6 w-6"
        />
        <span className="text-[14px] font-semibold tracking-tight text-neutral-200">
          Archos Labs
        </span>
      </div>

      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700/50 px-3 py-1.5 text-[13px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800/50 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </button>
        {mobile && onClose && (
          <button onClick={onClose} className="p-1 text-neutral-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-800/40 bg-neutral-900/50 px-2.5 py-1.5">
          <Search className="h-3 w-3 text-neutral-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent text-[13px] text-neutral-300 placeholder-neutral-600 outline-none"
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
                className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
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
              <p className="px-2 py-6 text-center text-[12px] text-neutral-600">
                No chats yet. Start one.
              </p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg px-2 py-1.5 ${
                  c.id === activeId
                    ? "bg-neutral-800/70 text-white"
                    : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200"
                }`}
              >
                <button
                  onClick={() => onSelectConversation(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <MessageSquare className="h-3 w-3 shrink-0 text-neutral-600" />
                  <span className="truncate text-[13px]">{c.title}</span>
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

        <div className="mt-4 border-t border-neutral-800/40 pt-2">
          <NavSection
            label="Skills"
            icon={Sparkles}
            open={skillsOpen}
            onToggle={() => setSkillsOpen(!skillsOpen)}
            href="/account/skills"
          />
          <NavSection
            label="Workflows"
            icon={GitBranch}
            open={workflowsOpen}
            onToggle={() => setWorkflowsOpen(!workflowsOpen)}
            href="/account/workflows"
          />
          <NavSection
            label="History"
            icon={Clock}
            open={historyOpen}
            onToggle={() => setHistoryOpen(!historyOpen)}
            href="/account/history"
          />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-600">
      {children}
    </p>
  );
}

function NavSection({
  label,
  icon: Icon,
  open,
  onToggle,
  href,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  open: boolean;
  onToggle: () => void;
  href: string;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-neutral-500 transition-colors hover:bg-neutral-800/40 hover:text-neutral-300"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <Link
          href={href}
          className="block rounded-lg py-1 pl-9 pr-2 text-[12px] text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
        >
          View all {label.toLowerCase()}
        </Link>
      )}
    </div>
  );
}
