"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminPageView } from "../../../../lib/pages/types";

interface PagesListProps {
  initial: AdminPageView[];
}

type ActionStatus =
  | { kind: "idle" }
  | { kind: "working"; id: string }
  | { kind: "error"; id: string; message: string };

export function PagesList({ initial }: PagesListProps) {
  const [pages, setPages] = useState(initial);
  const [status, setStatus] = useState<ActionStatus>({ kind: "idle" });

  async function onArchive(id: string) {
    if (!confirm("Archive this page? It will be hidden from the public site but can be restored later.")) return;
    setStatus({ kind: "working", id });
    try {
      const res = await fetch(`/api/admin/pages/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({
          kind: "error",
          id,
          message: json.error ?? "Archive failed.",
        });
        return;
      }
      setPages((cur) =>
        cur.map((p) => (p.id === id ? { ...p, archivedAt: new Date() } : p)),
      );
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "error", id, message: "Network error." });
    }
  }

  async function onRestore(id: string) {
    setStatus({ kind: "working", id });
    try {
      const res = await fetch(`/api/admin/pages/${id}/restore`, {
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
      setPages((cur) =>
        cur.map((p) => (p.id === id ? { ...p, archivedAt: null } : p)),
      );
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "error", id, message: "Network error." });
    }
  }

  const active = pages.filter((p) => p.archivedAt === null);
  const archived = pages.filter((p) => p.archivedAt !== null);

  return (
    <div className="space-y-12">
      <PagesTable
        rows={active}
        status={status}
        onArchive={onArchive}
        onRestore={onRestore}
        emptyMessage="No pages yet. Click 'New page' to create one."
      />
      {archived.length > 0 ? (
        <details className="rounded-md border border-hairline px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-subtle">
            Archived ({archived.length})
          </summary>
          <div className="mt-4">
            <PagesTable
              rows={archived}
              status={status}
              onArchive={onArchive}
              onRestore={onRestore}
              emptyMessage="No archived pages."
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

interface PagesTableProps {
  rows: AdminPageView[];
  status: ActionStatus;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  emptyMessage: string;
}

function PagesTable({
  rows,
  status,
  onArchive,
  onRestore,
  emptyMessage,
}: PagesTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-subtle">{emptyMessage}</p>;
  }
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="border-b border-hairline">
        <tr>
          <th className="py-2 pr-4 font-semibold text-ink">Slug</th>
          <th className="py-2 pr-4 font-semibold text-ink">Title</th>
          <th className="py-2 pr-4 font-semibold text-ink">Status</th>
          <th className="py-2 pr-4 font-semibold text-ink">Updated</th>
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
            <tr key={p.id} className="border-b border-hairline">
              <td className="py-3 pr-4 font-mono text-xs text-ink">
                /{p.slug}
              </td>
              <td className="py-3 pr-4 text-ink">{p.title}</td>
              <td className="py-3 pr-4">
                <StatusBadge status={p.status} archived={p.archivedAt !== null} />
              </td>
              <td className="py-3 pr-4 text-xs text-ink-subtle">
                {formatDate(p.updatedAt)}
              </td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-x-2 text-xs">
                  <Link
                    href={`/admin/pages/${p.id}`}
                    className="text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  <span className="text-ink-subtle/50">·</span>
                  <Link
                    href={`/admin/pages/${p.id}/revisions`}
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

function StatusBadge({
  status,
  archived,
}: {
  status: string;
  archived: boolean;
}) {
  if (archived) {
    return (
      <span className="rounded bg-surface-2 px-2 py-0.5 text-[11px] text-ink-subtle">
        archived
      </span>
    );
  }
  if (status === "published") {
    return (
      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
        published
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
      draft
    </span>
  );
}

function formatDate(d: Date): string {
  const iso = new Date(d).toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16);
}
