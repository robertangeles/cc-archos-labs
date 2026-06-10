"use client";

import { useEffect, useState, useCallback } from "react";

interface MemoryPage {
  slug: string;
  title: string;
  content: string;
  updatedAt?: string;
}

const PAGE_SIZE = 10;

export function BrainPageClient() {
  const [memories, setMemories] = useState<MemoryPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [_deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/brain/memories");
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void loadMemories();
  }, [loadMemories]);

  const handleDelete = async (slug: string) => {
    setDeleting(slug);
    try {
      const res = await fetch(`/api/brain/memories?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.slug !== slug));
      }
    } finally {
      setDeleting(null);
    }
  };

  const filtered = memories.filter((m) => {
    if (search && !m.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = search ? 0 : Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-[#141516] rounded" />
          <div className="h-10 bg-[#141516] rounded" />
          <div className="h-24 bg-[#141516] rounded" />
          <div className="h-24 bg-[#141516] rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold text-[#f7f8f8] tracking-tight">
            Your Brain
          </h1>
          <span className="text-sm text-[#8a8f98]">
            {memories.length} memor{memories.length === 1 ? "y" : "ies"}
          </span>
        </div>
        <p className="mt-2 text-sm text-[#8a8f98] leading-relaxed max-w-2xl">
          Your brain remembers what matters across conversations. It learns
          automatically from every chat — no setup, no commands. The more you
          chat, the smarter it gets. You can review, search, and delete any
          memory here.
        </p>
      </div>

      {memories.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[#62666d] mb-3">
            <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 className="text-[#f7f8f8] font-medium mb-2">Your brain is building</h2>
          <p className="text-[#8a8f98] text-sm max-w-md mx-auto">
            Start chatting with Metis and your brain will automatically learn
            what matters to you — your name, your projects, your preferences.
            No setup needed. Just talk.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Search memories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 rounded-md bg-[#141516] border border-[#23252a]
                         text-sm text-[#f7f8f8] placeholder-[#62666d]
                         focus:outline-none focus:border-[#5e6ad2]"
            />
          </div>

          <div className="space-y-2">
            {paginated.map((memory) => {
              const isExpanded = expanded === memory.slug;
              const summary = extractSummary(memory.content);
              return (
                <div
                  key={memory.slug}
                  className="rounded-lg bg-[#0f1011] border border-[#23252a] group"
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : memory.slug)}
                    className="w-full p-4 flex items-start gap-3 text-left"
                  >
                    <svg
                      className={`w-4 h-4 mt-0.5 shrink-0 text-[#62666d] transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#f7f8f8]">{summary}</p>
                      {memory.updatedAt && (
                        <p className="text-[11px] text-[#62666d] mt-1">
                          {new Date(memory.updatedAt).toLocaleString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    <span
                      onClick={(e) => { e.stopPropagation(); handleDelete(memory.slug); }}
                      className="p-1.5 rounded text-[#62666d] hover:text-red-400
                                 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      role="button"
                      aria-label="Delete memory"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pl-11">
                      <pre className="text-[13px] text-[#d0d6e0] whitespace-pre-wrap font-sans leading-relaxed">
                        {memory.content}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#23252a]">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-3 py-1.5 rounded text-sm text-[#d0d6e0] bg-[#141516] border border-[#23252a]
                           hover:border-[#34343a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-[#62666d]">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="px-3 py-1.5 rounded text-sm text-[#d0d6e0] bg-[#141516] border border-[#23252a]
                           hover:border-[#34343a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function extractSummary(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("#"));
  const userLine = lines.find((l) => !l.startsWith("##"));
  if (userLine && userLine.length > 10) {
    return userLine.length > 120 ? userLine.slice(0, 120) + "..." : userLine;
  }
  return content.slice(0, 120) + (content.length > 120 ? "..." : "");
}
