"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { DataModelSummary } from "@/hooks/use-models";

// ============================================================================
// DeleteModelDialog — destructive confirmation for model deletion.
//
// Migrated from Spresso (packages/client/src/components/model-studio/
// DeleteModelDialog.tsx). The Infection-Virus design is preserved verbatim;
// only the two Spresso text tokens that do not exist in this repo's design
// system were remapped to the equivalent target tokens:
//   text-text-primary   → text-ink
//   text-text-secondary → text-ink-subtle
// The axios-shaped error catch was adapted to this repo's plain-Error
// convention — the hook's `remove` throws a plain-language Error (see
// hooks/use-models.ts), so there is no axios `response.data` to read.
//
// Senior-practitioner UX contract: require exact `DELETE` confirmation
// (case-sensitive, no whitespace lenience) before the Delete button
// unlocks. Mirrors what Erwin / ER Studio / enterprise admin consoles
// do for irreversible operations. The Cascade copy makes the scope of
// the destruction explicit so nobody nukes a model thinking only the
// metadata row goes away.
//
// Rendered via React portal. ESC always cancels. Enter submits only when
// the gate is unlocked.
// ============================================================================

export interface DeleteModelDialogProps {
  model: DataModelSummary | null; // null → hidden
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
}

const GATE_WORD = "DELETE";

export function DeleteModelDialog({ model, onClose, onDelete }: DeleteModelDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = model !== null;

  useEffect(() => {
    if (!model) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form state when the dialog opens
    setConfirmText("");
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [model]);

  // ESC always cancels (even mid-type, even while submitting is false).
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!model) return null;

  // Trim ONLY trailing newlines (paste artefacts). No space-lenience.
  const normalised = confirmText.replace(/\n+$/, "");
  const unlocked = normalised === GATE_WORD;
  const canSubmit = unlocked && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDelete(model.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the model.");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) void handleConfirm();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-model-title"
      data-testid="delete-model-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        className={[
          "relative z-10 w-full max-w-md rounded-2xl p-6",
          "bg-surface-2/85 backdrop-blur-xl border border-red-500/25",
          "shadow-[0_0_48px_rgba(239,68,68,0.18)]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => !submitting && onClose()}
          className="absolute top-3 right-3 text-ink-subtle/70 hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative">
            <div
              className="absolute inset-0 bg-red-500/25 blur-xl rounded-full"
              aria-hidden="true"
            />
            <div className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-red-500/25 via-amber-500/10 to-transparent border border-red-500/40 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.3)]">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div>
            <h2 id="delete-model-title" className="text-base font-semibold text-ink">
              Delete this model?
            </h2>
            <p className="text-xs text-ink-subtle">This action cannot be undone.</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-ink-subtle leading-relaxed">
          <p>
            Deleting <strong className="text-ink">{model.name}</strong> is permanent. All
            entities, relationships, attributes, layer links, canvas positions, and audit history
            will be removed.
          </p>
        </div>

        <div className="mt-5">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
              Type <span className="font-mono font-semibold text-red-300">DELETE</span> to confirm
            </span>
            <input
              ref={inputRef}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
              data-testid="delete-model-input"
              className={[
                "w-full rounded-lg px-3 py-2 text-sm font-mono tracking-wider",
                "bg-surface-1/60 border text-ink",
                unlocked ? "border-red-500/50" : "border-white/10",
                "placeholder:text-ink-subtle/30",
                "focus:outline-none focus:shadow-[0_0_12px_rgba(239,68,68,0.2)]",
                "transition-all",
              ].join(" ")}
            />
          </label>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="mt-5 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            data-testid="delete-model-cancel"
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            data-testid="delete-model-confirm"
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold",
              "bg-gradient-to-r from-red-600 to-red-500 text-white",
              "shadow-[0_0_12px_rgba(239,68,68,0.3)]",
              "hover:shadow-[0_0_24px_rgba(239,68,68,0.45)]",
              "transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
            ].join(" ")}
          >
            {submitting ? "Deleting…" : "Delete model"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
