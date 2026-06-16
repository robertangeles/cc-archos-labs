"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { AttributeRow, EntityRow, VersionConflict } from "@/lib/model-studio/canvas-types";
import {
  ATTRIBUTE_CLASSIFICATION,
  type AttributeClassification,
  type AttributeCreate,
  type AttributeUpdate,
} from "@/lib/model-studio/canvas-validation";

// ============================================================================
// AttributePanel — a right-side drawer listing one entity's attributes with
// inline add/edit, PK/FK/unique/nullable flags, governance classification,
// alt-key group, and up/down reordering (no drag — buttons, per the migration's
// dependency policy). Surfaces 409 VERSION_CONFLICT with a refresh prompt.
// Rendered via portal so it floats above the canvas.
// ============================================================================

interface AttributeFormValues {
  name: string;
  dataType: string | null;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
  classification: AttributeClassification | null;
  altKeyGroup: string | null;
}

export interface AttributePanelProps {
  entity: EntityRow | null; // null → hidden
  attributes: AttributeRow[];
  conflict: VersionConflict | null;
  onClose: () => void;
  onCreate: (input: AttributeCreate) => Promise<unknown>;
  onUpdate: (attributeId: string, patch: AttributeUpdate) => Promise<unknown>;
  onReorder: (attributeId: string, direction: "up" | "down", version: number) => Promise<unknown>;
  onRemove: (attributeId: string) => Promise<void>;
  onResolveConflict: () => void;
}

const EMPTY_FORM: AttributeFormValues = {
  name: "",
  dataType: "",
  isPrimaryKey: false,
  isNullable: true,
  isUnique: false,
  isForeignKey: false,
  classification: null,
  altKeyGroup: null,
};

const fieldClass =
  "w-full rounded-md px-2 py-1.5 text-sm bg-surface-1/60 border border-white/10 text-ink placeholder:text-ink-subtle/40 focus:outline-none focus:border-primary/50 transition-colors";

function FlagChip({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors",
        active
          ? "bg-primary/20 text-primary"
          : "bg-surface-1/60 text-ink-tertiary hover:text-ink-subtle",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** Inline create/edit form for a single attribute. */
function AttributeEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: AttributeFormValues;
  busy: boolean;
  onSave: (v: AttributeFormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<AttributeFormValues>(initial);
  const set = <K extends keyof AttributeFormValues>(k: K, val: AttributeFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  return (
    <div className="rounded-lg border border-primary/30 bg-surface-1/40 p-3">
      <input
        autoFocus
        value={v.name}
        onChange={(e) => set("name", e.target.value)}
        maxLength={128}
        placeholder="Attribute name"
        className={`${fieldClass} mb-2`}
        data-testid="attribute-name"
      />
      <input
        value={v.dataType ?? ""}
        onChange={(e) => set("dataType", e.target.value || null)}
        maxLength={100}
        placeholder="Data type (e.g. varchar, uuid)"
        className={`${fieldClass} mb-2`}
      />
      <div className="mb-2 flex flex-wrap gap-1.5">
        <FlagChip label="PK" active={v.isPrimaryKey} onClick={() => set("isPrimaryKey", !v.isPrimaryKey)} title="Primary key" />
        <FlagChip label="FK" active={v.isForeignKey} onClick={() => set("isForeignKey", !v.isForeignKey)} title="Foreign key" />
        <FlagChip label="UQ" active={v.isUnique} onClick={() => set("isUnique", !v.isUnique)} title="Unique" />
        <FlagChip label="NULL" active={v.isNullable} onClick={() => set("isNullable", !v.isNullable)} title="Nullable" />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <select
          value={v.classification ?? ""}
          onChange={(e) =>
            set("classification", (e.target.value || null) as AttributeClassification | null)
          }
          className={fieldClass}
          title="Governance classification"
        >
          <option value="">No classification</option>
          {ATTRIBUTE_CLASSIFICATION.options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={v.altKeyGroup ?? ""}
          onChange={(e) => set("altKeyGroup", e.target.value || null)}
          placeholder="AK group (e.g. AK1)"
          className={fieldClass}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs text-ink-subtle hover:text-ink transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(v)}
          disabled={busy || v.name.trim().length === 0}
          data-testid="attribute-save"
          className="rounded-md bg-gradient-to-r from-primary to-primary-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function AttributePanel({
  entity,
  attributes,
  conflict,
  onClose,
  onCreate,
  onUpdate,
  onReorder,
  onRemove,
  onResolveConflict,
}: AttributePanelProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever the panel switches entities or closes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on entity switch
    setAdding(false);
    setEditingId(null);
    setError(null);
  }, [entity?.id]);

  if (!entity) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const toFormValues = (a: AttributeRow): AttributeFormValues => ({
    name: a.name,
    dataType: a.dataType,
    isPrimaryKey: a.isPrimaryKey,
    isNullable: a.isNullable,
    isUnique: a.isUnique,
    isForeignKey: a.isForeignKey,
    classification: a.classification as AttributeClassification | null,
    altKeyGroup: a.altKeyGroup,
  });

  return createPortal(
    <aside
      className="fixed top-0 right-0 z-40 flex h-full w-[360px] flex-col border-l border-hairline bg-surface-2/95 backdrop-blur-xl shadow-[-8px_0_32px_rgba(0,0,0,0.4)]"
      data-testid="attribute-panel"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{entity.name}</p>
          <p className="text-[11px] text-ink-subtle">Attributes</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close attributes"
          className="text-ink-subtle/70 hover:text-ink transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {conflict && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-ink-muted">
          An attribute changed elsewhere.
          <button type="button" onClick={onResolveConflict} className="font-medium text-primary hover:underline">
            Refresh
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {attributes.length === 0 && !adding && (
          <p className="py-6 text-center text-xs italic text-ink-tertiary">No attributes yet.</p>
        )}

        <ul className="space-y-1.5">
          {attributes.map((attr, i) => (
            <li key={attr.id}>
              {editingId === attr.id ? (
                <AttributeEditor
                  initial={toFormValues(attr)}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={(v) => run(() => onUpdate(attr.id, { ...v, version: attr.version }))}
                />
              ) : (
                <div className="group flex items-center gap-2 rounded-md border border-hairline bg-surface-1/40 px-2 py-1.5">
                  <span className="w-7 font-mono text-[10px] font-medium text-primary">
                    {attr.isPrimaryKey ? "PK" : attr.isForeignKey ? "FK" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{attr.name}</span>
                  {attr.dataType && (
                    <span className="truncate font-mono text-[10px] text-ink-tertiary">{attr.dataType}</span>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => run(() => onReorder(attr.id, "up", attr.version))}
                      className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === attributes.length - 1}
                      onClick={() => run(() => onReorder(attr.id, "down", attr.version))}
                      className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(attr.id)}
                      className="rounded p-1 text-ink-subtle hover:text-ink"
                      aria-label="Edit attribute"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onRemove(attr.id))}
                      className="rounded p-1 text-ink-subtle hover:text-red-400 disabled:opacity-50"
                      aria-label="Delete attribute"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {adding && (
          <div className="mt-2">
            <AttributeEditor
              initial={EMPTY_FORM}
              busy={busy}
              onCancel={() => setAdding(false)}
              onSave={(v) => run(() => onCreate(v))}
            />
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      <footer className="border-t border-hairline p-3">
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
          disabled={adding}
          data-testid="add-attribute"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface-1/40 px-3 py-2 text-sm font-medium text-ink hover:border-primary/50 transition-colors disabled:opacity-50"
        >
          <Plus className="h-4 w-4 text-primary" /> Add attribute
        </button>
      </footer>
    </aside>,
    document.body,
  );
}
