"use client";

import { useState, useEffect } from "react";
import { Paperclip, Loader2, FileText, Download, Trash2 } from "lucide-react";

// ============================================================================
// AttachmentsPanel — a self-contained, reusable files list for any resource
// that exposes the standard attachment endpoints:
//   GET    {basePath}            -> { ok, attachments: [...] }
//   POST   {basePath}            -> multipart "file"; { ok, attachment }; 503 if
//                                   storage (Cloudinary) is not configured
//   DELETE {basePath}/{id}       -> { ok }
// Used for client-contract attachments; the same contract is honoured by the
// Kanban card Files tab (kept inline there for its tab-count badge).
// ============================================================================

interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  fileSize: number | null;
  createdAt: string;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  basePath,
  canEdit = true,
}: {
  basePath: string;
  canEdit?: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(basePath, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.attachments) setItems(d.attachments);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [basePath]);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("Files must be 50MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(basePath, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 503) {
        setError(
          data?.error ??
            "File storage isn't configured. Add Cloudinary in admin settings.",
        );
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Upload failed. Please try again.");
        return;
      }
      if (data.attachment) setItems((prev) => [data.attachment, ...prev]);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
    await fetch(`${basePath}/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="mt-3 h-8 animate-pulse rounded-md border border-hairline bg-surface-1" />
    );
  }

  // Nothing to show and no way to add — render nothing to keep the row clean.
  if (items.length === 0 && !canEdit) return null;

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
        <Paperclip className="h-3 w-3" />
        Attachments{items.length > 0 && ` (${items.length})`}
      </div>

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-ink">{a.fileName}</p>
                {a.fileSize ? (
                  <p className="text-[10px] text-ink-tertiary">
                    {fmtSize(a.fileSize)}
                  </p>
                ) : null}
              </div>
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="Open file"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label="Remove file"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-semantic-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink">
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading…" : "Add a file (max 50MB)"}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {error && <p className="mt-1.5 text-xs text-semantic-error">{error}</p>}
    </div>
  );
}
