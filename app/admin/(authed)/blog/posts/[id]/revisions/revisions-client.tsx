"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RevisionView } from "../../../../../../../lib/posts-admin/types";

// Post revision history view. Mirrors the Pages CMS pattern:
//   - Newest revision tagged "current"
//   - Revisions with diff_size_pct >= 20 tagged "material change"
//   - View toggle expands the markdown body inline
//   - Restore POSTs to the restore endpoint, prepends the new revision
//     to the list, and refreshes the route

interface RevisionsClientProps {
  postId: string;
  initial: RevisionView[];
}

type ActionStatus =
  | { kind: "idle" }
  | { kind: "working"; revId: string }
  | { kind: "error"; revId: string; message: string };

export function RevisionsClient({ postId, initial }: RevisionsClientProps) {
  const router = useRouter();
  const [revisions, setRevisions] = useState(initial);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<ActionStatus>({ kind: "idle" });

  async function onRestore(revId: string) {
    if (
      !confirm(
        "Restore this revision? The current content will be replaced and a new revision documenting the restore will be created.",
      )
    ) {
      return;
    }
    setStatus({ kind: "working", revId });
    try {
      const res = await fetch(
        `/api/admin/posts/${postId}/revisions/${revId}/restore`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStatus({
          kind: "error",
          revId,
          message: json.error ?? "Restore failed.",
        });
        return;
      }
      setRevisions((cur) => [json.data.revision, ...cur]);
      setStatus({ kind: "idle" });
      router.refresh();
    } catch {
      setStatus({ kind: "error", revId, message: "Network error." });
    }
  }

  function toggleOpen(revId: string) {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(revId)) next.delete(revId);
      else next.add(revId);
      return next;
    });
  }

  if (revisions.length === 0) {
    return <p className="text-sm text-ink-subtle">No revisions yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {revisions.map((rev, idx) => {
        const isOpen = openIds.has(rev.id);
        const isWorking = status.kind === "working" && status.revId === rev.id;
        const errorForRow =
          status.kind === "error" && status.revId === rev.id
            ? status.message
            : null;
        const isCurrent = idx === 0;
        const pct = parseFloat(rev.diffSizePct);
        const isMaterial = pct >= 20;
        const isAutoPublish = rev.savedBy === "scheduler-cron";

        return (
          <li
            key={rev.id}
            className="rounded-md border border-hairline px-4 py-3"
          >
            <div className="flex items-start justify-between gap-x-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  {rev.title}{" "}
                  {isCurrent ? (
                    <span className="ml-2 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                      current
                    </span>
                  ) : null}
                  {isMaterial ? (
                    <span className="ml-2 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                      material change · {pct.toFixed(0)}%
                    </span>
                  ) : null}
                  {isAutoPublish ? (
                    <span className="ml-2 rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                      auto-published
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[12px] text-ink-subtle">
                  Saved by {rev.savedBy} · {formatDateTime(rev.savedAt)} ·{" "}
                  {rev.contentMd.length.toLocaleString()} chars
                </p>
              </div>
              <div className="flex items-center gap-x-3 text-xs">
                <button
                  onClick={() => toggleOpen(rev.id)}
                  className="text-ink-subtle hover:text-ink"
                >
                  {isOpen ? "Hide" : "View"}
                </button>
                {!isCurrent ? (
                  <button
                    onClick={() => onRestore(rev.id)}
                    disabled={isWorking}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    {isWorking ? "Restoring…" : "Restore"}
                  </button>
                ) : null}
              </div>
            </div>
            {errorForRow ? (
              <p className="mt-2 text-[11px] text-red-500">{errorForRow}</p>
            ) : null}
            {isOpen ? (
              <pre className="mt-3 max-h-[400px] overflow-auto rounded bg-surface-1 p-3 font-mono text-[11px] leading-[1.5] text-ink-subtle whitespace-pre-wrap">
                {rev.contentMd}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function formatDateTime(d: Date): string {
  const iso = new Date(d).toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC";
}
