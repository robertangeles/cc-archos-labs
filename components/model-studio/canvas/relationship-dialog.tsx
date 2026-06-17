"use client";

import { useEffect, useState } from "react";
import { Spline, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { RelationshipRow } from "@/lib/model-studio/canvas-types";
import { CARDINALITY, type Cardinality } from "@/lib/model-studio/canvas-validation";

// ============================================================================
// RelationshipDialog — create (from dragging an edge between two nodes) or edit
// a relationship: verb phrases, source/target cardinality, identifying, and
// nullable-FK. Mode-agnostic about endpoints (the canvas supplies them on
// create) and version (threaded in on edit). Portal + ESC + ⌘↵, primary glow.
// ============================================================================

export interface RelationshipFormValues {
  name: string | null;
  nameInverse: string | null;
  sourceCardinality: Cardinality;
  targetCardinality: Cardinality;
  isIdentifying: boolean;
  isNullableForeignKey: boolean;
}

export interface RelationshipDialogProps {
  open: boolean;
  relationship?: RelationshipRow | null; // present → edit mode
  sourceName?: string;
  targetName?: string;
  onClose: () => void;
  onSubmit: (values: RelationshipFormValues) => Promise<void>;
  onRequestDelete?: (relationship: RelationshipRow) => void;
}

const CARDINALITY_LABELS: Record<Cardinality, string> = {
  one: "Exactly one (1)",
  many: "Many (*)",
  zero_or_one: "Zero or one (0..1)",
  zero_or_many: "Zero or many (0..*)",
  one_or_many: "One or many (1..*)",
};

const DEFAULTS: RelationshipFormValues = {
  name: "",
  nameInverse: "",
  sourceCardinality: "one",
  targetCardinality: "zero_or_many",
  isIdentifying: false,
  isNullableForeignKey: false,
};

const fieldClass =
  "w-full rounded-lg px-3 py-2 text-sm bg-surface-1/60 border border-white/10 text-ink placeholder:text-ink-subtle/40 focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)] transition-all";

export function RelationshipDialog({
  open,
  relationship,
  sourceName,
  targetName,
  onClose,
  onSubmit,
  onRequestDelete,
}: RelationshipDialogProps) {
  const isEdit = !!relationship;
  const [v, setV] = useState<RelationshipFormValues>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RelationshipFormValues>(k: K, val: RelationshipFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed form when opened
    setV(
      relationship
        ? {
            name: relationship.name ?? "",
            nameInverse: relationship.nameInverse ?? "",
            sourceCardinality: relationship.sourceCardinality,
            targetCardinality: relationship.targetCardinality,
            isIdentifying: relationship.isIdentifying,
            isNullableForeignKey: relationship.isNullableForeignKey,
          }
        : DEFAULTS,
    );
    setError(null);
  }, [open, relationship]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        ...v,
        name: v.name?.trim() || null,
        nameInverse: v.nameInverse?.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save relationship");
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
      aria-labelledby="relationship-dialog-title"
      data-testid="relationship-dialog"
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
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-surface-2/80 p-6 backdrop-blur-xl shadow-[0_0_48px_rgba(94,106,210,0.15)]"
      >
        <button
          type="button"
          onClick={() => !submitting && onClose()}
          className="absolute top-3 right-3 text-ink-subtle/70 hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" aria-hidden="true" />
            <div className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-primary/40 bg-gradient-to-br from-primary/25 via-primary/5 to-transparent text-primary shadow-[0_0_12px_rgba(94,106,210,0.25)]">
              <Spline className="h-4 w-4" />
            </div>
          </div>
          <div className="min-w-0">
            <h2 id="relationship-dialog-title" className="text-base font-semibold text-ink">
              {isEdit ? "Edit relationship" : "New relationship"}
            </h2>
            {(sourceName || targetName) && (
              <p className="truncate text-xs text-ink-subtle">
                {sourceName ?? "source"} → {targetName ?? "target"}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Verb phrase
            </span>
            <input
              value={v.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
              maxLength={128}
              placeholder="e.g. places"
              data-testid="relationship-name"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Inverse phrase
            </span>
            <input
              value={v.nameInverse ?? ""}
              onChange={(e) => set("nameInverse", e.target.value)}
              maxLength={128}
              placeholder="e.g. placed by"
              className={fieldClass}
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Source cardinality
            </span>
            <select
              value={v.sourceCardinality}
              onChange={(e) => set("sourceCardinality", e.target.value as Cardinality)}
              className={fieldClass}
            >
              {CARDINALITY.options.map((c) => (
                <option key={c} value={c}>
                  {CARDINALITY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Target cardinality
            </span>
            <select
              value={v.targetCardinality}
              onChange={(e) => set("targetCardinality", e.target.value as Cardinality)}
              data-testid="relationship-target-cardinality"
              className={fieldClass}
            >
              {CARDINALITY.options.map((c) => (
                <option key={c} value={c}>
                  {CARDINALITY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={v.isIdentifying}
              onChange={(e) => set("isIdentifying", e.target.checked)}
              className="accent-[#5e6ad2]"
            />
            Identifying (solid line — the child can&rsquo;t exist without the parent)
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={v.isNullableForeignKey}
              onChange={(e) => set("isNullableForeignKey", e.target.checked)}
              className="accent-[#5e6ad2]"
            />
            Optional foreign key (nullable)
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          {isEdit && onRequestDelete && (
            <button
              type="button"
              onClick={() => relationship && onRequestDelete(relationship)}
              disabled={submitting}
              className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              data-testid="relationship-delete-trigger"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="relationship-save"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary-hover px-5 py-2 text-sm font-semibold text-white shadow-[0_0_12px_rgba(94,106,210,0.25)] hover:shadow-[0_0_24px_rgba(94,106,210,0.4)] transition-all disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create relationship"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
