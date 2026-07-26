"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type {
  AdminListFilter,
  AdminPostView,
} from "../../../../../lib/posts-admin/types";
import {
  formatMelbourneDateTime,
  formatMelbourneShort,
  melbourneTzAbbrev,
} from "../../../../../lib/format-melbourne";

// Client wrapper for the posts list. Filter pills + search box +
// pagination drive the URL (?status / ?search / ?page), which triggers a
// server re-render. Archive / restore actions hit the admin API directly
// and refresh the route.
//
// Filters available (each maps to a status= URL param):
//   All           — every status except archived
//   Draft         — status='draft'
//   Scheduled     — status='scheduled' (sorted soonest-first)
//   Published     — status='published'
//   Needs review  — needs_review=true (any non-archived status)
//   Archived      — archived_at IS NOT NULL (recovery view)

interface PostsListProps {
  initial: AdminPostView[];
  totalCount: number;
  page: number;
  totalPages: number;
  currentStatus: AdminListFilter;
  currentSearch: string;
}

type ActionStatus =
  | { kind: "idle" }
  | { kind: "working"; id: string }
  | { kind: "error"; id: string; message: string };

const FILTERS: Array<{ key: AdminListFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "needs_review", label: "Needs review" },
  { key: "archived", label: "Archived" },
];

export function PostsList({
  initial,
  totalCount,
  page,
  totalPages,
  currentStatus,
  currentSearch,
}: PostsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(currentSearch);
  const [posts, setPosts] = useState(initial);
  const [status, setStatus] = useState<ActionStatus>({ kind: "idle" });

  // Keep client list in sync with server-prop changes (after filter
  // change or router.refresh()). Mirrors how PagesList is wired.
  if (initial !== posts && status.kind === "idle") {
    setPosts(initial);
  }

  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Changing the filter resets to page 1.
    if (Object.keys(updates).some((k) => k !== "page")) {
      params.delete("page");
    }
    startTransition(() => {
      router.push(`/admin/blog/posts?${params.toString()}`);
    });
  }

  function onPickFilter(next: AdminListFilter) {
    updateUrl({ status: next === "all" ? null : next });
  }

  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault();
    updateUrl({ search: searchValue.trim() || null });
  }

  async function onArchive(id: string) {
    if (
      !confirm(
        "Archive this post? It will be hidden from /blog but can be restored later.",
      )
    ) {
      return;
    }
    setStatus({ kind: "working", id });
    try {
      const res = await fetch(`/api/admin/posts/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({
          kind: "error",
          id,
          message: json.error ?? "Archive failed.",
        });
        return;
      }
      setPosts((cur) =>
        cur.map((p) => (p.id === id ? { ...p, archivedAt: new Date() } : p)),
      );
      setStatus({ kind: "idle" });
      router.refresh();
    } catch {
      setStatus({ kind: "error", id, message: "Network error." });
    }
  }

  async function onRestore(id: string) {
    setStatus({ kind: "working", id });
    try {
      const res = await fetch(`/api/admin/posts/${id}/restore`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({
          kind: "error",
          id,
          message: json.error ?? "Restore failed.",
        });
        return;
      }
      setPosts((cur) =>
        cur.map((p) => (p.id === id ? { ...p, archivedAt: null } : p)),
      );
      setStatus({ kind: "idle" });
      router.refresh();
    } catch {
      setStatus({ kind: "error", id, message: "Network error." });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onPickFilter(f.key)}
            disabled={isPending}
            className={`rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
              currentStatus === f.key
                ? "border-primary bg-primary text-canvas"
                : "border-hairline text-ink-subtle hover:text-ink"
            } disabled:opacity-50`}
          >
            {f.label}
          </button>
        ))}

        <form onSubmit={onSubmitSearch} className="ml-auto">
          <label className="sr-only" htmlFor="post-search">
            Search posts
          </label>
          <input
            id="post-search"
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search title or slug…"
            className="w-64 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </form>
      </div>

      <p className="text-[12px] text-ink-subtle">
        {totalCount.toLocaleString()} {totalCount === 1 ? "post" : "posts"}
        {currentSearch ? ` matching "${currentSearch}"` : ""}
        {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
      </p>

      <PostsTable
        rows={posts}
        status={status}
        onArchive={onArchive}
        onRestore={onRestore}
        emptyMessage={
          currentStatus === "all" && !currentSearch
            ? "No posts yet. Click '+ New post' to create one."
            : "No posts match this filter. Clear filters to see everything."
        }
      />

      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} updateUrl={updateUrl} />
      ) : null}
    </div>
  );
}

interface PostsTableProps {
  rows: AdminPostView[];
  status: ActionStatus;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  emptyMessage: string;
}

function PostsTable({
  rows,
  status,
  onArchive,
  onRestore,
  emptyMessage,
}: PostsTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-subtle">{emptyMessage}</p>;
  }
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="border-b border-hairline">
        <tr>
          <th className="py-2 pr-4 font-semibold text-ink">Title</th>
          <th className="py-2 pr-4 font-semibold text-ink">Status</th>
          <th className="py-2 pr-4 font-semibold text-ink">Category</th>
          <th className="py-2 pr-4 font-semibold text-ink">Date</th>
          <th className="py-2 text-right font-semibold text-ink">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const isWorking = status.kind === "working" && status.id === p.id;
          const errorForRow =
            status.kind === "error" && status.id === p.id
              ? status.message
              : null;
          return (
            <tr key={p.id} className="border-b border-hairline align-top">
              <td className="py-3 pr-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-ink">{p.title}</span>
                  {/* 120 migrated WordPress posts also carry needs_review, so
                      without this marker an agent draft is indistinguishable
                      from a decade-old import in the review queue. */}
                  {p.isAgentGenerated ? (
                    <span className="shrink-0 rounded-full border border-hairline px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-subtle">
                      Agent
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-ink-subtle">
                  /blog/{p.slug}
                </div>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge post={p} />
              </td>
              <td className="py-3 pr-4 text-xs text-ink-subtle">
                {p.categoryName ?? "—"}
              </td>
              <td className="py-3 pr-4 text-xs text-ink-subtle">
                <DateCell post={p} />
              </td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-x-2 text-xs">
                  <Link
                    href={`/admin/blog/posts/${p.id}`}
                    className="text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  <span className="text-ink-subtle/50">·</span>
                  <Link
                    href={`/admin/blog/posts/${p.id}/revisions`}
                    className="text-primary hover:underline"
                  >
                    Revisions
                  </Link>
                  <span className="text-ink-subtle/50">·</span>
                  {p.archivedAt === null ? (
                    <button
                      onClick={() => onArchive(p.id)}
                      disabled={isWorking}
                      className="text-ink-subtle hover:text-ink disabled:opacity-50"
                    >
                      {isWorking ? "Archiving…" : "Archive"}
                    </button>
                  ) : (
                    <button
                      onClick={() => onRestore(p.id)}
                      disabled={isWorking}
                      className="text-ink-subtle hover:text-ink disabled:opacity-50"
                    >
                      {isWorking ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
                {errorForRow ? (
                  <p className="mt-1 text-[10px] text-red-500">{errorForRow}</p>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({ post }: { post: AdminPostView }) {
  if (post.archivedAt !== null) {
    return (
      <Badge tone="muted">archived</Badge>
    );
  }
  if (post.needsReview) {
    return (
      <div className="flex flex-col gap-y-1">
        <StatusLabelOnly status={post.status} scheduledAt={post.scheduledPublishAt} />
        <Badge tone="amber">needs review</Badge>
      </div>
    );
  }
  return <StatusLabelOnly status={post.status} scheduledAt={post.scheduledPublishAt} />;
}

function StatusLabelOnly({
  status,
  scheduledAt,
}: {
  status: string;
  scheduledAt: Date | null;
}) {
  if (status === "published") {
    return <Badge tone="emerald">published</Badge>;
  }
  if (status === "scheduled" && scheduledAt) {
    return (
      <Badge tone="indigo">scheduled · {formatScheduleShort(scheduledAt)}</Badge>
    );
  }
  if (status === "draft") {
    return <Badge tone="slate">draft</Badge>;
  }
  return <Badge tone="muted">{status}</Badge>;
}

type BadgeTone = "muted" | "emerald" | "amber" | "indigo" | "slate";

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: BadgeTone;
}) {
  const toneClasses: Record<BadgeTone, string> = {
    muted: "bg-surface-2 text-ink-subtle",
    emerald:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    slate: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  updateUrl,
}: {
  page: number;
  totalPages: number;
  updateUrl: (updates: Record<string, string | null>) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-4">
      <button
        type="button"
        onClick={() => updateUrl({ page: String(page - 1) })}
        disabled={page <= 1}
        className="text-xs text-ink-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        ← Previous
      </button>
      <span className="text-xs text-ink-subtle">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => updateUrl({ page: String(page + 1) })}
        disabled={page >= totalPages}
        className="text-xs text-ink-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        Next →
      </button>
    </div>
  );
}

// Date columns in this list render in Melbourne wall-time to match the
// scheduled-publish picker (which is Melbourne-anchored). Plain
// .toISOString() showed UTC, so 09:00 Melbourne schedules appeared as
// "previous day 23:00Z" in the list — see lib/format-melbourne.ts.
function formatDate(d: Date): string {
  return formatMelbourneDateTime(new Date(d));
}

/**
 * Date cell that picks the most meaningful date for the row's status:
 *   - scheduled  → scheduledPublishAt (when it WILL go live)
 *   - published  → publishedAt (original WP date for migrated rows;
 *                  admin publish date for new rows)
 *   - archived   → archivedAt
 *   - draft      → updatedAt (last admin touch)
 * The small label above the value tells you which date it is, so you
 * don't have to remember the column convention. Migration date
 * (created_at / updated_at) is hidden — for the 253 migrated posts
 * those all point at 2026-05-20 and tell you nothing about the post.
 */
function DateCell({ post }: { post: AdminPostView }) {
  let label = "Updated";
  let date: Date | null = post.updatedAt;
  if (post.archivedAt) {
    label = "Archived";
    date = post.archivedAt;
  } else if (post.status === "scheduled" && post.scheduledPublishAt) {
    label = "Scheduled";
    date = post.scheduledPublishAt;
  } else if (post.status === "published" && post.publishedAt) {
    label = "Published";
    date = post.publishedAt;
  } else if (post.status === "draft") {
    label = "Edited";
    date = post.updatedAt;
  }
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle/70">
        {label}
      </span>
      <span>{date ? formatDate(date) : "—"}</span>
    </div>
  );
}

function formatScheduleShort(d: Date): string {
  return `${formatMelbourneShort(new Date(d))} ${melbourneTzAbbrev()}`;
}
