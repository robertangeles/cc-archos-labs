// Shared block types. Importable from both server and client code.
//
// Phase 2 block_type values are an open union (string) backed by the
// registry at lib/pages/blocks/registry.ts. The registry is the single
// source of truth for which block types exist and what their props look
// like. The renderer treats an unknown block_type as a render-time
// failure (placeholder + admin warning), never a crash.

export type BlockType =
  | "hero"
  | "proof_grid"
  | "service_grid"
  | "cta_pair"
  | "markdown";

export interface BlockRow {
  id: string;
  pageId: string;
  blockType: string; // wider than BlockType; validated against registry at use
  position: number;
  props: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Input shape for create+update via admin. New blocks have no id; the
// admin form generates a stable client-side id (for drag-reorder + key
// stability) which the server replaces with a real uuid on insert.
export interface BlockInput {
  id?: string;
  blockType: string;
  position: number;
  props: Record<string, unknown>;
}
