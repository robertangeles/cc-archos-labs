"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { EntityRow } from "@/lib/model-studio/canvas-types";

// ============================================================================
// DeleteEntityDialog — confirm deleting an entity. Deleting cascades the
// entity's attributes and any relationships touching it, so we say so plainly.
// No type-to-confirm gate (entity delete is routine modelling, unlike deleting
// a whole model); a clear confirm is enough. React portal, ESC closes.
// ============================================================================

export interface DeleteEntityDialogProps {
  entity: EntityRow | null; // null → hidden
  onClose: () => void;
  onConfirm: (entity: EntityRow) => Promise<void>;
}

export function DeleteEntityDialog({ entity, onClose, onConfirm }: DeleteEntityDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = entity !== null;

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!entity) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(entity);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entity");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-entity-title"
      data-testid="delete-entity-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-surface-2/80 p-6 backdrop-blur-xl shadow-[0_0_48px_rgba(239,68,68,0.12)]">
        <button
          type="button"
          onClick={() => !submitting && onClose()}
          className="absolute top-3 right-3 text-ink-subtle/70 hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <h2 id="delete-entity-title" className="text-base font-semibold text-ink">
            Delete entity
          </h2>
        </div>

        <p className="text-sm text-ink-muted">
          Delete <span className="font-semibold text-ink">{entity.name}</span>
          {entity.displayId ? ` (${entity.displayId})` : ""}? Its attributes and any
          relationships connected to it will be removed too. This can&rsquo;t be undone.
        </p>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="delete-entity-confirm"
            className="inline-flex items-center gap-2 rounded-lg bg-red-500/90 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-60"
          >
            {submitting ? "Deleting…" : "Delete entity"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
