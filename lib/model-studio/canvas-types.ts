// ============================================================================
// Model Studio canvas — API row shapes (client-facing).
//
// These mirror the service selections in lib/model-studio/canvas-service.ts as
// they appear over JSON: timestamps are ISO strings, jsonb columns are typed
// objects. Shared by the client hooks (hooks/use-*.ts) and the canvas
// components so the wire shape is declared once.
// ============================================================================

import type { Layer, Notation } from "./validation";
import type { Cardinality } from "./canvas-validation";

export interface EntityRow {
  id: string;
  dataModelId: string;
  name: string;
  businessName: string | null;
  description: string | null;
  entityType: "standard" | "associative" | "subtype" | "supertype";
  layer: Layer;
  displayId: string | null;
  altKeyLabels: Record<string, string>;
  metadata: Record<string, unknown>;
  tags: string[];
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttributeRow {
  id: string;
  dataModelId: string;
  entityId: string;
  name: string;
  dataType: string | null;
  dataTypeParams: Record<string, unknown> | null;
  ordinalPosition: number;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
  classification: string | null;
  altKeyGroup: string | null;
  defaultValue: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipRow {
  id: string;
  dataModelId: string;
  sourceEntityId: string;
  targetEntityId: string;
  name: string | null;
  nameInverse: string | null;
  sourceCardinality: Cardinality;
  targetCardinality: Cardinality;
  isIdentifying: boolean;
  isNullableForeignKey: boolean;
  description: string | null;
  metadata: Record<string, unknown>;
  waypoints: Array<{ x: number; y: number }> | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasStateRow {
  layer: Layer;
  nodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
  notation: Notation;
  updatedAt: string | null;
}

/** Surfaced by a mutating hook when the server rejects a stale optimistic-lock
 *  write (409 VERSION_CONFLICT). The component prompts the user to refresh. */
export interface VersionConflict {
  serverVersion: number;
}
