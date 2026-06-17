"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PenLine } from "lucide-react";
import { XIcon, LinkedinIcon, BlueskyIcon } from "@/components/icons/social";
import type { SocialPlatform } from "@/lib/social/types";
import { PLATFORM_DISPLAY_NAMES, PLATFORM_MAX_CHAR_LIMITS, SOCIAL_PLATFORMS } from "@/lib/social/types";
import { PublishModal } from "@/components/social/publish-modal";
import { DateField } from "@/components/ui/date-field";

/* ------------------------------------------------------------------ */
/* Platform icon mapping                                              */
/* ------------------------------------------------------------------ */

const PLATFORM_ICONS: Record<
  SocialPlatform,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  twitter: XIcon,
  linkedin: LinkedinIcon,
  bluesky: BlueskyIcon,
};

/* ------------------------------------------------------------------ */
/* Status badge styling                                               */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<string, string> = {
  pending: "border-yellow-700/40 bg-yellow-950/20 text-yellow-400",
  processing: "border-blue-700/40 bg-blue-950/20 text-blue-400",
  published: "border-green-700/40 bg-green-950/20 text-green-400",
  failed: "border-red-700/40 bg-red-950/20 text-red-400",
  cancelled: "border-hairline bg-surface-1 text-ink-subtle",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Scheduled",
  processing: "Publishing...",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface ScheduledPost {
  id: string;
  platform: SocialPlatform;
  contentPreview: string;
  content: string;
  scheduledFor: string;
  displayTimezone: string;
  status: string;
  publishedUrl: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function ScheduledPostsList() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [connectedPlatforms, setConnectedPlatforms] = useState<SocialPlatform[]>([]);
  const [activeTab, setActiveTab] = useState<"scheduled" | "posted">("scheduled");

  /* Delete confirmation: id of the post awaiting a confirm tap */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  /* Inline edit state (content + schedule) */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  /* ---------------------------------------------------------------- */
  /* Fetch posts                                                      */
  /* ---------------------------------------------------------------- */

  const fetchRef = useRef(0);

  useEffect(() => {
    const id = ++fetchRef.current;
    (async () => {
      try {
        const res = await fetch("/api/social/scheduled");
        if (id !== fetchRef.current) return;
        if (!res.ok) {
          setError("Failed to load scheduled posts.");
          return;
        }
        const data = await res.json();
        setPosts(data.posts ?? []);
        setError(null);
      } catch {
        if (id === fetchRef.current) setError("Network error loading posts.");
      } finally {
        if (id === fetchRef.current) setLoading(false);
      }
    })();

    Promise.all(
      SOCIAL_PLATFORMS.map((p) =>
        fetch(`/api/social/${p}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d?.connected ? p : null))
          .catch(() => null),
      ),
    ).then((results) => {
      setConnectedPlatforms(results.filter((p): p is SocialPlatform => p !== null));
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/social/scheduled");
      if (!res.ok) return;
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    const hasActive = posts.some(
      (p) => p.status === "pending" || p.status === "processing",
    );
    if (!hasActive) return;

    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [posts, refresh]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  const handleDelete = useCallback(
    async (id: string) => {
      setConfirmingDeleteId(null);
      /* Optimistic removal */
      setPosts((prev) => prev.filter((p) => p.id !== id));
      try {
        await fetch(`/api/social/scheduled/${id}`, { method: "DELETE" });
      } catch {
        /* Re-fetch on failure to restore truth */
        refresh();
      }
    },
    [refresh],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      /* Optimistic status flip */
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "pending" } : p)),
      );
      try {
        await fetch(`/api/social/scheduled/${id}/retry`, {
          method: "POST",
        });
      } catch {
        refresh();
      }
    },
    [refresh],
  );

  const startEditing = useCallback((post: ScheduledPost) => {
    const dt = new Date(post.scheduledFor);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const min = String(dt.getMinutes()).padStart(2, "0");
    setEditContent(post.content);
    setEditDate(`${yyyy}-${mm}-${dd}`);
    setEditTime(`${hh}:${min}`);
    setEditingId(post.id);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditContent("");
    setEditDate("");
    setEditTime("");
  }, []);

  const confirmReschedule = useCallback(async () => {
    if (!editingId || !editDate || !editTime || !editContent.trim()) return;
    setSaving(true);

    const content = editContent.trim();
    const scheduledFor = new Date(`${editDate}T${editTime}`).toISOString();
    const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const res = await fetch(`/api/social/scheduled/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledFor, displayTimezone, content }),
      });
      if (res.ok) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === editingId
              ? {
                  ...p,
                  content,
                  contentPreview: content.slice(0, 200),
                  scheduledFor,
                  displayTimezone,
                  status: "pending",
                }
              : p,
          ),
        );
        cancelEditing();
      }
    } catch {
      /* Silently fail; user can retry */
    } finally {
      setSaving(false);
    }
  }, [editingId, editContent, editDate, editTime, cancelEditing]);

  /* ---------------------------------------------------------------- */
  /* Sort: upcoming first                                             */
  /* ---------------------------------------------------------------- */

  const scheduled = posts
    .filter((p) => p.status === "pending" || p.status === "processing" || p.status === "failed" || p.status === "cancelled")
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const posted = posts
    .filter((p) => p.status === "published")
    .sort((a, b) => new Date(b.publishedAt ?? b.scheduledFor).getTime() - new Date(a.publishedAt ?? a.scheduledFor).getTime());

  const displayList = activeTab === "scheduled" ? scheduled : posted;

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <p className="text-sm text-ink-subtle">Loading scheduled posts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink">Social Media Posts</h1>
        {connectedPlatforms.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPublishModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
          >
            <PenLine className="h-3.5 w-3.5" />
            New Post
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-1 border-b border-hairline">
        {(["scheduled", "posted"] as const).map((tab) => {
          const count = tab === "scheduled" ? scheduled.length : posted.length;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "text-ink" : "text-ink-subtle hover:text-ink"
              }`}
            >
              {tab === "scheduled" ? "Scheduled" : "Posted"}
              {count > 0 && (
                <span className={`ml-1.5 text-[10px] ${isActive ? "text-ink-subtle" : "text-ink-subtle/60"}`}>
                  {count}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {displayList.length === 0 ? (
        <p className="mt-6 text-sm text-ink-subtle">
          {activeTab === "scheduled"
            ? connectedPlatforms.length > 0
              ? "No scheduled posts. Click \"New Post\" to compose and schedule content."
              : "Connect a social account first, then schedule content from here."
            : "No published posts yet."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {displayList.map((post) => {
            const Icon = PLATFORM_ICONS[post.platform];
            const isEditing = editingId === post.id;

            return (
              <div
                key={post.id}
                className="rounded-md border border-hairline bg-surface-2 p-4"
              >
                {/* Header: platform + status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="h-3.5 w-3.5 text-ink-subtle" />}
                    <span className="text-xs font-medium text-ink">
                      {PLATFORM_DISPLAY_NAMES[post.platform]}
                    </span>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      STATUS_STYLES[post.status] ?? STATUS_STYLES.pending
                    }`}
                  >
                    {STATUS_LABELS[post.status] ?? post.status}
                  </span>
                </div>

                {/* Content preview (hidden while editing) */}
                {!isEditing && (
                  <p className="mt-2 line-clamp-2 text-xs text-ink-subtle">
                    {post.contentPreview}
                  </p>
                )}

                {/* Scheduled time or inline editor */}
                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <div>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={5}
                        className="w-full resize-none rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-subtle/50 focus:border-primary focus:outline-none"
                        placeholder={`Content for ${PLATFORM_DISPLAY_NAMES[post.platform]}...`}
                      />
                      <div className="mt-1 flex justify-end">
                        <span
                          className={`text-[10px] ${
                            editContent.length > PLATFORM_MAX_CHAR_LIMITS[post.platform]
                              ? "text-red-400"
                              : "text-ink-subtle"
                          }`}
                        >
                          {editContent.length}/{PLATFORM_MAX_CHAR_LIMITS[post.platform]}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <DateField
                        value={editDate}
                        onChange={setEditDate}
                        placeholder="DD/MM/YYYY"
                        className="flex-1"
                        min={new Date().toISOString().split("T")[0]}
                      />
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="w-28 rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-xs text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={confirmReschedule}
                        disabled={
                          saving ||
                          !editDate ||
                          !editTime ||
                          !editContent.trim() ||
                          editContent.length > PLATFORM_MAX_CHAR_LIMITS[post.platform]
                        }
                        className="rounded-md bg-primary px-3 py-1 text-[10px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="rounded-md border border-hairline px-3 py-1 text-[10px] font-medium text-ink-subtle transition-colors hover:bg-surface-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-ink-subtle">
                    {new Date(post.scheduledFor).toLocaleString()}{" "}
                    ({post.displayTimezone})
                  </p>
                )}

                {/* Error message for failed posts */}
                {post.status === "failed" && post.errorMessage && (
                  <p className="mt-2 rounded-md border border-red-700/40 bg-red-950/20 px-2.5 py-1.5 text-[10px] text-red-400">
                    {post.errorMessage}
                  </p>
                )}

                {/* Action buttons per status (or the delete confirmation prompt) */}
                {confirmingDeleteId === post.id && !isEditing ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-red-400">
                      Delete permanently? This can&apos;t be undone.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(post.id)}
                      className="rounded-md border border-red-700/40 bg-red-950/20 px-2.5 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    {post.status === "pending" && !isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditing(post)}
                          className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(post.id)}
                          className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-950/20"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {post.status === "failed" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRetry(post.id)}
                          className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(post.id)}
                          className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-950/20"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {post.status === "cancelled" && (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(post.id)}
                        className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-950/20"
                      >
                        Delete
                      </button>
                    )}
                    {post.status === "published" && post.publishedUrl && (
                      <a
                        href={post.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-hairline px-2.5 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        View
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showPublishModal && connectedPlatforms.length > 0 && (
        <PublishModal
          defaultContent=""
          connectedPlatforms={connectedPlatforms}
          onClose={() => setShowPublishModal(false)}
          onPublished={() => {
            setShowPublishModal(false);
            refresh();
          }}
          onScheduled={() => {
            setShowPublishModal(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
