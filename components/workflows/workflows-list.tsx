"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GitBranch, Plus, Copy, Trash2 } from "lucide-react";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-500/10 text-amber-500",
  published: "bg-green-500/10 text-green-500",
  archived: "bg-ink-subtle/10 text-ink-subtle",
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WorkflowsList() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data) => setWorkflows(data.workflows ?? []))
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, []);

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await fetch(`/api/workflows/${id}/duplicate`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setWorkflows((prev) => [data.workflow, ...prev]);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(id);
    const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    if (res.ok) {
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    }
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <GitBranch className="mx-auto h-8 w-8 text-ink-tertiary" />
        <p className="mt-3 text-sm font-medium text-ink">No workflows yet</p>
        <p className="mt-1 text-xs text-ink-subtle">
          Create your first AI orchestration pipeline.
        </p>
        <Link
          href="/account/workflows/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          New Workflow
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] text-ink-tertiary">
          {workflows.length} workflow{workflows.length === 1 ? "" : "s"}
        </p>
        <Link
          href="/account/workflows/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New Workflow
        </Link>
      </div>

      <ul className="space-y-2">
        {workflows.map((w) => (
          <li key={w.id}>
            <Link
              href={`/account/workflows/${w.id}`}
              className="flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <GitBranch className="h-4 w-4" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">
                    {w.name}
                  </span>
                  {w.description && (
                    <span className="line-clamp-1 text-xs text-ink-subtle">
                      {w.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => handleDuplicate(e, w.id)}
                  className="rounded p-1.5 text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
                  title="Duplicate"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, w.id)}
                  disabled={deleting === w.id}
                  className="rounded p-1.5 text-ink-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="flex flex-col items-end gap-0.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[w.status] ?? STATUS_STYLES.draft}`}
                  >
                    {w.status}
                  </span>
                  <span className="text-[11px] text-ink-tertiary">
                    {formatDate(w.updatedAt)}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
