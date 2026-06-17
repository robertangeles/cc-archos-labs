"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { RelationshipRow } from "@/lib/model-studio/canvas-types";
import type { Cardinality } from "@/lib/model-studio/canvas-validation";

// ============================================================================
// RelationshipEdge — a custom React Flow edge for a data-model relationship.
// Identifying relationships render solid; non-identifying render dashed (IE
// convention). Each end shows a compact cardinality glyph, and the verb phrase
// (if any) sits at the midpoint. Migrated from Spresso's RelationshipEdge,
// simplified for the first canvas pass (full crow's-foot SVG markers later).
// ============================================================================

export interface RelationshipEdgeData extends Record<string, unknown> {
  rel: RelationshipRow;
}

export type RelationshipEdgeType = Edge<RelationshipEdgeData, "relationship">;

/** Compact textual cardinality glyph (kept readable at zoom). */
const CARDINALITY_GLYPH: Record<Cardinality, string> = {
  one: "1",
  many: "*",
  zero_or_one: "0..1",
  zero_or_many: "0..*",
  one_or_many: "1..*",
};

export function RelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<RelationshipEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const rel = data?.rel;
  const dashed = rel ? !rel.isIdentifying : true;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeWidth: selected ? 2 : 1.5,
          stroke: selected ? "var(--color-primary)" : "var(--color-hairline-strong)",
          strokeDasharray: dashed ? "5 4" : undefined,
        }}
      />
      {rel && (
        <EdgeLabelRenderer>
          {/* Source-end cardinality. */}
          <span
            className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2 rounded bg-surface-1/90 px-1 font-mono text-[10px] text-ink-subtle"
            style={{ transform: `translate(-50%,-50%) translate(${sourceX}px,${sourceY}px)` }}
          >
            {CARDINALITY_GLYPH[rel.sourceCardinality]}
          </span>
          {/* Verb phrase at the midpoint, if named. */}
          {rel.name && (
            <span
              className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2 rounded bg-surface-1/90 px-1.5 py-0.5 text-[10px] text-ink-muted"
              style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
            >
              {rel.name}
            </span>
          )}
          {/* Target-end cardinality. */}
          <span
            className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2 rounded bg-surface-1/90 px-1 font-mono text-[10px] text-ink-subtle"
            style={{ transform: `translate(-50%,-50%) translate(${targetX}px,${targetY}px)` }}
          >
            {CARDINALITY_GLYPH[rel.targetCardinality]}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
