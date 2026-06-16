"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useEntities } from "@/hooks/use-entities";
import { useAttributes } from "@/hooks/use-attributes";
import { useRelationships } from "@/hooks/use-relationships";
import { useCanvasState } from "@/hooks/use-canvas-state";
import type { Layer } from "@/lib/model-studio/validation";
import type { EntityRow, RelationshipRow } from "@/lib/model-studio/canvas-types";
import { EntityNode, type EntityNodeType } from "./entity-node";
import { RelationshipEdge, type RelationshipEdgeType } from "./relationship-edge";
import { EntityDialog, type EntityFormValues } from "./entity-dialog";
import { DeleteEntityDialog } from "./delete-entity-dialog";
import { AttributePanel } from "./attribute-panel";
import { RelationshipDialog, type RelationshipFormValues } from "./relationship-dialog";

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

  // Entity dialog state: create (no entity), edit (entity set), delete confirm.
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRow | null>(null);
  const [deleting, setDeleting] = useState<EntityRow | null>(null);
  // Single-click selects an entity and opens its attribute panel.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onNodeClick = useCallback<NodeMouseHandler>((_e, node) => {
    setSelectedId(node.id);
  }, []);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      const entity = entities.find((x) => x.id === node.id);
      if (entity) setEditing(entity);
    },
    [entities],
  );

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId],
  );
  const selectedAttributes = useMemo(
    () => attributes.filter((a) => a.entityId === selectedId),
    [attributes, selectedId],
  );

  const handleCreate = useCallback(
    async (values: EntityFormValues) => {
      await entitiesHook.create({ ...values, layer });
    },
    [entitiesHook, layer],
  );

  const handleEdit = useCallback(
    async (values: EntityFormValues) => {
      if (!editing) return;
      await entitiesHook.update(editing.id, { ...values, version: editing.version });
    },
    [editing, entitiesHook],
  );

  const handleDelete = useCallback(
    (entity: EntityRow) => entitiesHook.remove(entity.id),
    [entitiesHook],
  );

  // Relationship dialog state: create (endpoints from a drag-connect) + edit.
  const [relCreate, setRelCreate] = useState<{ source: string; target: string } | null>(null);
  const [relEdit, setRelEdit] = useState<RelationshipRow | null>(null);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) setRelCreate({ source: c.source, target: c.target });
  }, []);

  const onEdgeDoubleClick = useCallback<EdgeMouseHandler>(
    (_e, edge) => {
      const rel = relationships.find((r) => r.id === edge.id);
      if (rel) setRelEdit(rel);
    },
    [relationships],
  );

  const handleRelCreate = useCallback(
    async (values: RelationshipFormValues) => {
      if (!relCreate) return;
      await relationshipsHook.create({
        sourceEntityId: relCreate.source,
        targetEntityId: relCreate.target,
        ...values,
      });
    },
    [relCreate, relationshipsHook],
  );

  const handleRelEdit = useCallback(
    async (values: RelationshipFormValues) => {
      if (!relEdit) return;
      await relationshipsHook.update(relEdit.id, { ...values, version: relEdit.version });
    },
    [relEdit, relationshipsHook],
  );

  const handleRelDelete = useCallback(
    async (rel: RelationshipRow) => {
      await relationshipsHook.remove(rel.id);
      setRelEdit(null);
    },
    [relationshipsHook],
  );

  const nameOf = useCallback(
    (id?: string) => entities.find((e) => e.id === id)?.name,
    [entities],
  );
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

  // Autosave layout. Gate on the canvas-state load so the initial fitView can't
  // persist fallback-grid positions over a saved layout before it hydrates.
  const { getViewport } = useReactFlow();
  const canvasLoading = canvasState.isLoading;
  const persistLayout = useCallback(() => {
    if (canvasLoading) return;
    const nodePositions = Object.fromEntries(
      nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    canvasState.save({ nodePositions, viewport: getViewport() });
  }, [canvasLoading, nodes, canvasState, getViewport]);

  const conflict = entitiesHook.conflict ?? relationshipsHook.conflict;

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onConnect={onConnect}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeDragStop={persistLayout}
        onMoveEnd={persistLayout}
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

        <Panel position="top-left">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-testid="add-entity"
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-2/90 px-3 py-1.5 text-sm font-medium text-ink shadow-sm backdrop-blur hover:border-primary/50 transition-colors"
          >
            <Plus className="h-4 w-4 text-primary" /> Add entity
          </button>
        </Panel>

        {conflict && (
          <Panel position="top-center">
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-surface-2/95 px-3 py-2 text-xs text-ink-muted shadow-md backdrop-blur">
              This changed in another tab.
              <button
                type="button"
                onClick={() => {
                  void entitiesHook.refresh();
                  void relationshipsHook.refresh();
                  entitiesHook.clearConflict();
                  relationshipsHook.clearConflict();
                }}
                className="font-medium text-primary hover:underline"
              >
                Refresh
              </button>
            </div>
          </Panel>
        )}
      </ReactFlow>

      <EntityDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
      <EntityDialog
        open={editing !== null}
        entity={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleEdit}
        onRequestDelete={(entity) => {
          setEditing(null);
          setDeleting(entity);
        }}
      />
      <DeleteEntityDialog
        entity={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
      />

      <AttributePanel
        entity={selectedEntity}
        attributes={selectedAttributes}
        conflict={attributesHook.conflict}
        onClose={() => setSelectedId(null)}
        onCreate={(input) => attributesHook.create(selectedId!, input)}
        onUpdate={(attributeId, patch) => attributesHook.update(selectedId!, attributeId, patch)}
        onReorder={(attributeId, direction, version) =>
          attributesHook.reorder(selectedId!, attributeId, direction, version)
        }
        onRemove={(attributeId) => attributesHook.remove(selectedId!, attributeId)}
        onResolveConflict={() => {
          void attributesHook.refresh();
          attributesHook.clearConflict();
        }}
      />

      <RelationshipDialog
        open={relCreate !== null}
        sourceName={nameOf(relCreate?.source)}
        targetName={nameOf(relCreate?.target)}
        onClose={() => setRelCreate(null)}
        onSubmit={handleRelCreate}
      />
      <RelationshipDialog
        open={relEdit !== null}
        relationship={relEdit}
        sourceName={nameOf(relEdit?.sourceEntityId)}
        targetName={nameOf(relEdit?.targetEntityId)}
        onClose={() => setRelEdit(null)}
        onSubmit={handleRelEdit}
        onRequestDelete={handleRelDelete}
      />
    </>
  );
}

export function ModelCanvas({ modelId, layer }: { modelId: string; layer: Layer }) {
  return (
    <div className="absolute inset-0">
      <ReactFlowProvider>
        <InnerCanvas modelId={modelId} layer={layer} />
      </ReactFlowProvider>
    </div>
  );
}
