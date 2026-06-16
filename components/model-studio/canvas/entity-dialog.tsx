"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { EntityRow } from "@/lib/model-studio/canvas-types";
import { ENTITY_TYPE, type EntityType } from "@/lib/model-studio/canvas-validation";

// ============================================================================
// EntityDialog — create or edit an entity. Mode-agnostic about layer (the
// canvas creates on its active layer) and version (the canvas threads it in);
// this dialog only collects name / business name / description / type. Mirrors
// the model dialogs: React portal, ESC closes, ⌘↵ saves, primary-token glow.
// In edit mode it also exposes a Delete affordance via onRequestDelete.
// ============================================================================

export interface EntityFormValues {
  name: string;
  businessName: string | null;
  description: string | null;
  entityType: EntityType;
}

export interface EntityDialogProps {
  open: boolean;
  entity?: EntityRow | null; // present → edit mode
  onClose: () => void;
  onSubmit: (values: EntityFormValues) => Promise<void>;
  onRequestDelete?: (entity: EntityRow) => void;
}

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  standard: "Standard",
  associative: "Associative",
  subtype: "Subtype",
  supertype: "Supertype",
};

export function EntityDialog({
  open,
  entity,
  onClose,
  onSubmit,
  onRequestDelete,
}: EntityDialogProps) {
  const isEdit = !!entity;
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed form when opened
    setName(entity?.name ?? "");
    setBusinessName(entity?.businessName ?? "");
    setDescription(entity?.description ?? "");
    setEntityType((entity?.entityType as EntityType) ?? "standard");
    setError(null);
    setTimeout(() => nameInputRef.current?.focus(), 30);
  }, [open, entity]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= 128 && !submitting;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        businessName: businessName.trim() || null,
        description: description.trim() || null,
        entityType,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entity");
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

  const fieldClass = [
    "w-full rounded-lg px-3 py-2 text-sm",
    "bg-surface-1/60 border border-white/10 text-ink",
    "placeholder:text-ink-subtle/40",
    "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
    "transition-all",
  ].join(" ");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="entity-dialog-title"
      data-testid="entity-dialog"
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
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" aria-hidden="true" />
            <div className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent border border-primary/40 text-primary shadow-[0_0_12px_rgba(94,106,210,0.25)]">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div>
            <h2 id="entity-dialog-title" className="text-base font-semibold text-ink">
              {isEdit ? "Edit entity" : "Add entity"}
            </h2>
            <p className="text-xs text-ink-subtle">
              {isEdit ? entity?.displayId : "A new box on the canvas."}
            </p>
          </div>
        </div>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
            Entity name
          </span>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            placeholder="e.g. Customer"
            data-testid="entity-name"
            className={fieldClass}
            required
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
              Business name
            </span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              maxLength={255}
              placeholder="optional"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
              Type
            </span>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              data-testid="entity-type"
              className={fieldClass}
            >
              {ENTITY_TYPE.options.map((t) => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
            Description <span className="normal-case tracking-normal text-ink-subtle/50">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="What does this entity represent?"
            className={`${fieldClass} resize-y min-h-[72px] max-h-[200px]`}
          />
        </label>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="mt-5 flex items-center gap-2 justify-end">
          {isEdit && onRequestDelete && (
            <button
              type="button"
              onClick={() => entity && onRequestDelete(entity)}
              disabled={submitting}
              className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              data-testid="entity-delete-trigger"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="entity-save"
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold",
              "bg-gradient-to-r from-primary to-primary-hover text-white",
              "shadow-[0_0_12px_rgba(94,106,210,0.25)] hover:shadow-[0_0_24px_rgba(94,106,210,0.4)]",
              "transition-all disabled:opacity-60 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add entity"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
