"use client";

import { useState } from "react";
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  type BlockTypeKey,
} from "../../../../lib/pages/blocks/registry";
import type { BlockInputView } from "../../../../lib/pages/types";
import { ZodForm } from "./zod-form";

// BlocksEditor — admin UI for composing a page from section blocks.
//
// State model: the editor owns the full block list as local state. The
// parent form passes the initial list (from page load) and a callback
// to receive the current list on every change. The form persists the
// list on save (full overwrite — delete-all-then-insert semantics).
//
// Per-block field editor: tailored to a block_type when there's value
// in being explicit (Hero, ProofGrid, ServiceGrid, CtaPair) and falls
// back to a raw-JSON textarea for blocks whose props would otherwise
// generate a sprawling form (Markdown, custom blocks added later).
//
// Reordering: HTML5 native drag-and-drop + Up/Down buttons fallback.
// No new dependency. Position values are derived from array index at
// save time — the editor only tracks order in its local array.

export interface BlocksEditorProps {
  /** Page id. Used only for fetching initial blocks on mount when not
   *  pre-loaded (current implementation pre-loads on the server). */
  pageId?: string;
  /** Initial block list, in render order (position ASC). */
  initial: BlockInputView[];
  /** Called on every change with the current ordered list. */
  onChange: (blocks: BlockInputView[]) => void;
}

let nextLocalId = 0;
function clientId() {
  return `local-${++nextLocalId}-${Date.now()}`;
}

export function BlocksEditor({ initial, onChange }: BlocksEditorProps) {
  const [blocks, setBlocks] = useState<BlockInputView[]>(() =>
    initial.map((b) => ({
      ...b,
      id: b.id ?? clientId(),
    })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(
    blocks[0]?.id ?? null,
  );

  function commit(next: BlockInputView[]) {
    setBlocks(next);
    onChange(next);
  }

  function addBlock(blockType: BlockTypeKey) {
    const entry = BLOCK_REGISTRY[blockType];
    const newBlock: BlockInputView = {
      id: clientId(),
      blockType,
      position: blocks.length,
      props: structuredClone(entry.defaultProps) as Record<string, unknown>,
    };
    commit([...blocks, newBlock]);
    setPickerOpen(false);
    setExpandedId(newBlock.id ?? null);
  }

  function removeBlock(id: string) {
    if (!confirm("Remove this block? The change applies when you save the page."))
      return;
    commit(blocks.filter((b) => b.id !== id));
  }

  function moveBlock(id: string, dir: -1 | 1) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[target]] = [next[target], next[idx]];
    commit(next);
  }

  function updateProps(id: string, nextProps: Record<string, unknown>) {
    commit(
      blocks.map((b) => (b.id === id ? { ...b, props: nextProps } : b)),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          Blocks ({blocks.length})
        </h2>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-canvas hover:opacity-90"
        >
          {pickerOpen ? "Cancel" : "+ Add block"}
        </button>
      </div>

      {pickerOpen ? (
        <div className="rounded-md border border-hairline bg-surface-1 p-4">
          <p className="mb-3 text-[12px] uppercase tracking-wider text-ink-subtle">
            Pick a block to add
          </p>
          <ul className="grid gap-2 md:grid-cols-2">
            {BLOCK_TYPES.map((bt) => (
              <li key={bt}>
                <button
                  type="button"
                  onClick={() => addBlock(bt)}
                  className="w-full rounded-md border border-hairline bg-canvas p-3 text-left text-sm transition-colors hover:border-primary"
                >
                  <span className="font-semibold text-ink">
                    {BLOCK_REGISTRY[bt].label}
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-subtle">
                    {BLOCK_REGISTRY[bt].description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p className="rounded-md border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-subtle">
          No blocks yet. Click &ldquo;+ Add block&rdquo; to compose this page.
        </p>
      ) : (
        <ol className="space-y-3">
          {blocks.map((block, idx) => (
            <BlockRow
              key={block.id}
              block={block}
              index={idx}
              total={blocks.length}
              expanded={expandedId === block.id}
              onToggle={() =>
                setExpandedId((cur) =>
                  cur === block.id ? null : (block.id ?? null),
                )
              }
              onMoveUp={() => moveBlock(block.id!, -1)}
              onMoveDown={() => moveBlock(block.id!, 1)}
              onRemove={() => removeBlock(block.id!)}
              onPropsChange={(nextProps) => updateProps(block.id!, nextProps)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

interface BlockRowProps {
  block: BlockInputView;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onPropsChange: (props: Record<string, unknown>) => void;
}

function BlockRow({
  block,
  index,
  total,
  expanded,
  onToggle,
  onMoveUp,
  onMoveDown,
  onRemove,
  onPropsChange,
}: BlockRowProps) {
  const registry = BLOCK_REGISTRY[block.blockType as BlockTypeKey];
  const label = registry?.label ?? `Unknown: ${block.blockType}`;
  const description = registry?.description ?? "Block type is not in the registry.";

  return (
    <li className="rounded-md border border-hairline">
      <header className="flex items-center justify-between gap-x-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-x-3 text-left"
        >
          <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-semibold text-ink">{label}</span>
          <span className="text-[11px] text-ink-subtle">{description}</span>
        </button>
        <div className="flex items-center gap-x-1 text-[12px]">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded px-2 py-1 text-ink-subtle hover:text-ink disabled:opacity-30"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded px-2 py-1 text-ink-subtle hover:text-ink disabled:opacity-30"
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-red-500 hover:bg-red-500/10"
            aria-label="Remove block"
          >
            ✕
          </button>
        </div>
      </header>
      {expanded ? (
        <div className="border-t border-hairline px-4 py-4">
          <PropsEditor
            blockType={block.blockType}
            value={block.props}
            onChange={onPropsChange}
          />
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// PropsEditor — per-field form by default (ZodForm), JSON escape hatch.
//
// L2 ships per-field forms generated from the block's Zod schema. The
// schema is the single source of truth: adding a field to a block's
// schema appears in the editor with zero UI code change.
//
// JSON view is preserved as a toggle for:
//   - Power users pasting known-good blobs
//   - Block types using Zod constructs the introspector doesn't yet
//     handle (record/union/etc. — the field-introspection module
//     surfaces those as 'unknown' with a friendly fallback message)
//   - Debugging when the per-field UI has an unexpected bug
// ---------------------------------------------------------------------------

function PropsEditor({
  blockType,
  value,
  onChange,
}: {
  blockType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const registryEntry = BLOCK_REGISTRY[blockType as BlockTypeKey];
  const [mode, setMode] = useState<"fields" | "json">("fields");

  if (!registryEntry) {
    // Unknown block_type — registry/renderer drift. Fall back to JSON
    // so the user can at least see + correct the props.
    return (
      <JsonEditor blockType={blockType} value={value} onChange={onChange} />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-ink-subtle">
          Props · {registryEntry.label}
        </p>
        <div className="flex items-center gap-x-2 text-[11px]">
          <button
            type="button"
            onClick={() => setMode("fields")}
            className={`rounded px-2 py-0.5 ${
              mode === "fields"
                ? "bg-primary/10 text-primary"
                : "text-ink-subtle hover:text-ink"
            }`}
          >
            Fields
          </button>
          <button
            type="button"
            onClick={() => setMode("json")}
            className={`rounded px-2 py-0.5 ${
              mode === "json"
                ? "bg-primary/10 text-primary"
                : "text-ink-subtle hover:text-ink"
            }`}
          >
            Show as JSON
          </button>
        </div>
      </div>

      {mode === "fields" ? (
        <ZodForm
          schema={registryEntry.schema}
          value={value}
          onChange={onChange}
        />
      ) : (
        <JsonEditor
          blockType={blockType}
          value={value}
          onChange={onChange}
        />
      )}

      <p className="mt-3 text-[11px] text-ink-subtle">
        Validated against the block schema on save.
      </p>
    </div>
  );
}

// JSON editor as the escape hatch + the universal fallback for blocks
// whose schema uses Zod constructs the introspector doesn't yet handle.
function JsonEditor({
  blockType,
  value,
  onChange,
}: {
  blockType: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  function onTextChange(next: string) {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setError("Props must be a JSON object.");
        return;
      }
      setError(null);
      onChange(parsed as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON.");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] text-ink-subtle">
          JSON · {blockType}
        </p>
        {error ? (
          <p className="text-[11px] text-red-500">{error}</p>
        ) : null}
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        className={`w-full rounded-md border ${
          error ? "border-red-500/40" : "border-hairline"
        } bg-canvas px-3 py-2 font-mono text-[12px] leading-[1.5] text-ink min-h-[300px]`}
        spellCheck={false}
      />
    </div>
  );
}
