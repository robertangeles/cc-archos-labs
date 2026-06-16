"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { AttributeRow, EntityRow } from "@/lib/model-studio/canvas-types";

// ============================================================================
// EntityNode — a custom React Flow node rendering one entity as an ER-style
// box: a header with the display id chip + name, then attribute rows with
// PK/FK key glyphs. Migrated from Spresso's EntityNode; the Infection-Virus
// accent (yellow) is remapped to this repo's primary lavender via tokens.
// Pure presentation — all data arrives via node.data from model-canvas.tsx.
// ============================================================================

export interface EntityNodeData extends Record<string, unknown> {
  entity: EntityRow;
  attributes: AttributeRow[];
}

export type EntityNodeType = Node<EntityNodeData, "entity">;

/** A small fixed-width glyph column marking each attribute's key role. */
function KeyGlyph({ attr }: { attr: AttributeRow }) {
  if (attr.isPrimaryKey) {
    return <span className="text-primary" title="Primary key">PK</span>;
  }
  if (attr.isForeignKey) {
    return <span className="text-ink-subtle" title="Foreign key">FK</span>;
  }
  return <span className="text-ink-tertiary" aria-hidden />;
}

export function EntityNode({ data, selected }: NodeProps<EntityNodeType>) {
  const { entity, attributes } = data;

  return (
    <div
      className={[
        "w-60 overflow-hidden rounded-lg border bg-surface-2 text-left",
        "shadow-[0_1px_2px_rgba(0,0,0,0.4)]",
        selected ? "border-primary" : "border-hairline",
      ].join(" ")}
    >
      {/* Edges attach to these; hidden until hover/connect to keep the box clean. */}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-hairline !bg-surface-4" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-hairline !bg-surface-4" />

      <header className="flex items-center gap-2 border-b border-hairline bg-surface-3 px-3 py-2">
        {entity.displayId && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
            {entity.displayId}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{entity.name}</p>
          {entity.businessName && (
            <p className="truncate text-[11px] text-ink-subtle">{entity.businessName}</p>
          )}
        </div>
      </header>

      {attributes.length === 0 ? (
        <p className="px-3 py-2 text-[11px] italic text-ink-tertiary">No attributes yet</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {attributes.map((attr) => (
            <li
              key={attr.id}
              className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-2 px-3 py-1.5"
            >
              <span className="font-mono text-[10px] font-medium">
                <KeyGlyph attr={attr} />
              </span>
              <span
                className={[
                  "truncate text-xs",
                  attr.isPrimaryKey ? "font-medium text-ink" : "text-ink-muted",
                ].join(" ")}
              >
                {attr.name}
              </span>
              {attr.dataType && (
                <span className="truncate font-mono text-[10px] text-ink-tertiary">
                  {attr.dataType}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
