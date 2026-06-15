"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { DataModelSummary } from "@/hooks/use-models";

// ============================================================================
// EditModelDialog — rename / re-describe an existing model.
//
// Migrated from Spresso (packages/client/src/components/model-studio/
// EditModelDialog.tsx). The Infection-Virus design is preserved; the only
// changes are the design-token remap and this repo's plain-Error convention.
//
// Token remap (Spresso → this repo, see iteration 6/7 notes):
//   accent (yellow #FFD60A)        → primary (Linear lavender #5e6ad2)
//   rgba(255,214,10,*) glow        → rgba(94,106,210,*) (= primary rgb)
//   text-text-primary              → text-ink
//   text-text-secondary            → text-ink-subtle
//   amber-600 / text-black on CTA  → primary-hover / text-white
//
// Scope is intentionally narrow (name + description only). `activeLayer`,
// `notation`, and `originDirection` are model-defining decisions that anchor
// entities, relationships, and audit history; mutating them mid-stream would
// break traceability, so they stay locked here.
//
// Error handling is adapted to this repo's plain-Error convention: `onSave`
// (wired to the hook's `update`) throws a plain-language Error, so there is no
// axios `response.data` to read.
//
// Rendered via React portal. ESC closes, ⌘↵ / Ctrl↵ saves.
// ============================================================================

export interface EditModelDialogProps {
  model: DataModelSummary | null; // null → hidden
  onClose: () => void;
  onSave: (patch: { name?: string; description?: string | null }) => Promise<void>;
}

export function EditModelDialog({ model, onClose, onSave }: EditModelDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const open = model !== null;

  // Seed state from the model whenever a new one is opened.
  useEffect(() => {
    if (!model) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed form from the opened model
    setName(model.name);
    setDescription(model.description ?? "");
    setError(null);
    setTimeout(() => nameInputRef.current?.focus(), 30);
  }, [model]);

  // ESC closes (unless we're mid-save).
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!model) return null;

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const initialName = model.name;
  const initialDesc = model.description ?? "";
  const dirty = trimmedName !== initialName.trim() || trimmedDesc !== initialDesc.trim();
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= 200 && dirty && !submitting;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const patch: { name?: string; description?: string | null } = {};
      if (trimmedName !== initialName.trim()) patch.name = trimmedName;
      if (trimmedDesc !== initialDesc.trim()) {
        patch.description = trimmedDesc.length > 0 ? trimmedDesc : null;
      }
      await onSave(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-model-title"
      data-testid="edit-model-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <form
        onSubmit={handleSubmit}
        onKeyDown={onKeyDown}
        className={[
          "relative z-10 w-full max-w-md rounded-2xl p-6",
          "bg-surface-2/80 backdrop-blur-xl border border-white/10",
          "shadow-[0_0_48px_rgba(94,106,210,0.15)]",
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
              className="absolute inset-0 bg-primary/20 blur-xl rounded-full"
              aria-hidden="true"
            />
            <div className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent border border-primary/40 text-primary shadow-[0_0_12px_rgba(94,106,210,0.25)]">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div>
            <h2 id="edit-model-title" className="text-base font-semibold text-ink">
              Edit model
            </h2>
            <p className="text-xs text-ink-subtle">
              Rename and refine the description. Layer, notation, and origin stay locked to preserve
              traceability.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
            Model name
          </span>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. Customer Domain Model"
            data-testid="edit-model-name"
            className={[
              "w-full rounded-lg px-3 py-2 text-sm",
              "bg-surface-1/60 border border-white/10 text-ink",
              "placeholder:text-ink-subtle/40",
              "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
              "transition-all",
            ].join(" ")}
            required
          />
        </label>

        <div className="mt-4" />
        <label className="block">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Description{" "}
              <span className="normal-case tracking-normal text-ink-subtle/50">(optional)</span>
            </span>
            <span className="text-[10px] text-ink-subtle/50 tabular-nums">
              {description.length} / 2,000
            </span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="What does this model capture? Who relies on it? Notes for future-you and anyone else inheriting it."
            data-testid="edit-model-description"
            className={[
              "w-full rounded-lg px-3 py-2 text-sm resize-y min-h-[84px] max-h-[220px]",
              "bg-surface-1/60 border border-white/10 text-ink",
              "placeholder:text-ink-subtle/40",
              "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
              "transition-all",
            ].join(" ")}
          />
        </label>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="mt-5 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
            disabled={submitting}
            data-testid="edit-model-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="edit-model-save"
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold",
              "bg-gradient-to-r from-primary to-primary-hover text-white",
              "shadow-[0_0_12px_rgba(94,106,210,0.25)]",
              "hover:shadow-[0_0_24px_rgba(94,106,210,0.4)]",
              "transition-all disabled:opacity-60 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
