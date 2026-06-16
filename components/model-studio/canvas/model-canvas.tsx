"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEntities } from "@/hooks/use-entities";
import { useAttributes } from "@/hooks/use-attributes";
import { useRelationships } from "@/hooks/use-relationships";
import { useCanvasState } from "@/hooks/use-canvas-state";
import type { Layer } from "@/lib/model-studio/validation";
import { EntityNode, type EntityNodeType } from "./entity-node";
import { RelationshipEdge, type RelationshipEdgeType } from "./relationship-edge";

// ============================================================================
// ModelCanvas — the React Flow surface for one model + layer (read-only render
// pass: shows entities as nodes and relationships as edges, draggable for
// layout but not yet persisted — autosave lands in a later step). The CSS is
// imported here (not globals.css) so Tailwind v4's layer ordering can't clobber
// React Flow's base styles. Self-contained: wraps its own ReactFlowProvider.
// ============================================================================

// Stable references — React Flow requires nodeTypes/edgeTypes identity to be
// constant across renders, so they live at module scope.
const nodeTypes = { entity: EntityNode };
const edgeTypes = { relationship: RelationshipEdge };

// Deterministic fallback grid when a node has no saved position yet.
function gridPosition(index: number) {
  return { x: (index % 4) * 300, y: Math.floor(index / 4) * 240 };
}

function InnerCanvas({ modelId, layer }: { modelId: string; layer: Layer }) {
  const entitiesHook = useEntities(modelId, layer);
  const attributesHook = useAttributes(modelId);
  const relationshipsHook = useRelationships(modelId);
  const canvasState = useCanvasState(modelId, layer);

  const { entities } = entitiesHook;
  const { attributes } = attributesHook;
  const { relationships } = relationshipsHook;
  const positions = useMemo(
    () => canvasState.state?.nodePositions ?? {},
    [canvasState.state],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationshipEdgeType>([]);

  // Group attributes by entity once per change.
  const attrsByEntity = useMemo(() => {
    const map = new Map<string, typeof attributes>();
    for (const a of attributes) {
      const list = map.get(a.entityId) ?? [];
      list.push(a);
      map.set(a.entityId, list);
    }
    return map;
  }, [attributes]);

  // Rebuild nodes when entities, their attributes, or saved positions change.
  useEffect(() => {
    setNodes(
      entities.map((entity, i) => ({
        id: entity.id,
        type: "entity" as const,
        position: positions[entity.id] ?? gridPosition(i),
        data: { entity, attributes: attrsByEntity.get(entity.id) ?? [] },
      })),
    );
  }, [entities, attrsByEntity, positions, setNodes]);

  // Rebuild edges; only draw those whose both endpoints are visible on this layer.
  useEffect(() => {
    const visible = new Set(entities.map((e) => e.id));
    setEdges(
      relationships
        .filter((r) => visible.has(r.sourceEntityId) && visible.has(r.targetEntityId))
        .map((rel) => ({
          id: rel.id,
          source: rel.sourceEntityId,
          target: rel.targetEntityId,
          type: "relationship" as const,
          data: { rel },
        })),
    );
  }, [relationships, entities, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="bg-canvas"
    >
      <Background color="var(--color-hairline)" gap={20} />
      <Controls className="!border-hairline !bg-surface-2" />
    </ReactFlow>
  );
}

export function ModelCanvas({ modelId, layer }: { modelId: string; layer: Layer }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <InnerCanvas modelId={modelId} layer={layer} />
      </ReactFlowProvider>
    </div>
  );
}
