"use client";

import { useState } from "react";

// Drawer that calls /api/admin/posts/[id]/suggest-links with the
// current draft body, displays the top 5 similar published posts, and
// lets the author insert a markdown link to any of them at the textarea
// cursor (or wrap selected text).
//
// Slide-in from the right; clicking the backdrop or the close button
// dismisses. Results are NOT auto-cached on the client — each open
// triggers a fresh suggest call so the most recent draft text is what
// drives the suggestions.

interface LinkSuggestion {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  distance: number;
}

interface DrawerProps {
  open: boolean;
  postId: string;
  draft: { title: string; excerpt: string; contentMd: string };
  onClose: () => void;
  onInsertLink: (markdown: string) => void;
}

type LoadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; suggestions: LinkSuggestion[] }
  | { kind: "error"; message: string };

export function LinkSuggestionsDrawer({
  open,
  postId,
  draft,
  onClose,
  onInsertLink,
}: DrawerProps) {
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });

  // Auto-fetch on open. The drawer remounts when `open` flips false→true
  // because the parent unmounts it; that's fine because we want fresh
  // suggestions each time anyway.
  if (open && status.kind === "idle") {
    void fetchSuggestions();
  }

  async function fetchSuggestions() {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/admin/posts/${postId}/suggest-links`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            excerpt: draft.excerpt || null,
            contentMd: draft.contentMd || null,
            limit: 5,
          }),
        },
      );
      const json = await res.json();
      if (res.status === 429) {
        setStatus({
          kind: "error",
          message: "Rate limit reached — try again in an hour.",
        });
        return;
      }
      if (res.status === 503) {
        setStatus({
          kind: "error",
          message: "Suggestions unavailable — try again shortly.",
        });
        return;
      }
      if (!res.ok || !json.ok) {
        setStatus({
          kind: "error",
          message: json.error ?? "Could not load suggestions.",
        });
        return;
      }
      setStatus({ kind: "ready", suggestions: json.data });
    } catch {
      setStatus({ kind: "error", message: "Network error — try again." });
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close suggestions"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm"
      />
      {/* Drawer panel */}
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-hairline bg-canvas p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Suggested links</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-subtle hover:text-ink"
          >
            Close
          </button>
        </div>
        <p className="mb-6 text-xs text-ink-subtle">
          Top 5 published posts most semantically similar to the current
          draft. Click &quot;Insert link&quot; to drop a markdown link at
          your cursor (or wrap selected text).
        </p>

        {status.kind === "loading" ? (
          <p className="text-sm text-ink-subtle">Loading suggestions…</p>
        ) : status.kind === "error" ? (
          <div>
            <p className="text-sm text-red-500" role="alert">
              {status.message}
            </p>
            <button
              type="button"
              onClick={fetchSuggestions}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : status.kind === "ready" ? (
          status.suggestions.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              No related posts yet — publish a few more and try again.
            </p>
          ) : (
            <ul className="space-y-4">
              {status.suggestions.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-hairline p-4"
                >
                  <p className="text-xs text-ink-subtle">
                    {s.categoryName ?? "Uncategorised"} · distance{" "}
                    {s.distance.toFixed(3)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {s.title}
                  </p>
                  {s.excerpt ? (
                    <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
                      {s.excerpt.slice(0, 160)}
                      {s.excerpt.length > 160 ? "…" : ""}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      onInsertLink(`[${s.title}](/blog/${s.slug})`);
                      onClose();
                    }}
                    className="mt-3 text-xs text-primary hover:underline"
                  >
                    Insert link →
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </aside>
    </>
  );
}
