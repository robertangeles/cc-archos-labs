"use client";

import { useCallback, useEffect, useState } from "react";
import type { AttributeRow, VersionConflict } from "@/lib/model-studio/canvas-types";
import type {
  AttributeCreate,
  AttributeUpdate,
} from "@/lib/model-studio/canvas-validation";

// ============================================================================
// useAttributes — batch-loads every attribute in a model (one request via
// /attributes) and exposes per-entity create/update/remove/reorder. Same
// conventions as use-entities: plain fetch, optimistic local state, 409
// VERSION_CONFLICT surfaced as `conflict`.
// ============================================================================

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useAttributes(modelId: string) {
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const modelBase = `/api/model-studio/${modelId}`;
  // Stable per model so the mutation callbacks below can depend on it without
  // being recreated every render.
  const attrBase = useCallback(
    (entityId: string) => `${modelBase}/entities/${entityId}/attributes`,
    [modelBase],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${modelBase}/attributes`, { credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; attributes?: AttributeRow[]; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not load attributes. Please try again.");
        setAttributes([]);
        return;
      }
      setError(null);
      setAttributes(data.attributes ?? []);
    } catch {
      setError("Something went wrong loading attributes. Please try again.");
      setAttributes([]);
    } finally {
      setIsLoading(false);
    }
  }, [modelBase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (entityId: string, input: AttributeCreate): Promise<AttributeRow> => {
      const res = await fetch(attrBase(entityId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; attribute?: AttributeRow; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.attribute) {
        throw new Error(await readError(res, "Could not add the attribute."));
      }
      setAttributes((prev) => [...prev, data.attribute!]);
      return data.attribute;
    },
    [attrBase],
  );

  // Shared PATCH handler for both field updates and reorders.
  const patch = useCallback(
    async (
      entityId: string,
      attributeId: string,
      body: AttributeUpdate | { action: "reorder"; direction: "up" | "down"; version: number },
    ): Promise<AttributeRow | null> => {
      const res = await fetch(`${attrBase(entityId)}/${attributeId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; attribute?: AttributeRow; code?: string; serverVersion?: number; error?: string }
        | null;
      if (res.status === 409 && data?.code === "VERSION_CONFLICT") {
        setConflict({ serverVersion: data.serverVersion ?? 0 });
        return null;
      }
      if (!res.ok || !data?.ok || !data.attribute) {
        throw new Error(await readError(res, "Could not update the attribute."));
      }
      // A reorder changes two rows' ordinals — refetch to stay consistent.
      await refresh();
      return data.attribute;
    },
    [attrBase, refresh],
  );

  const update = useCallback(
    (entityId: string, attributeId: string, body: AttributeUpdate) =>
      patch(entityId, attributeId, body),
    [patch],
  );

  const reorder = useCallback(
    (entityId: string, attributeId: string, direction: "up" | "down", version: number) =>
      patch(entityId, attributeId, { action: "reorder", direction, version }),
    [patch],
  );

  const remove = useCallback(
    async (entityId: string, attributeId: string): Promise<void> => {
      const res = await fetch(`${attrBase(entityId)}/${attributeId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Could not delete the attribute."));
      }
      setAttributes((prev) => prev.filter((a) => a.id !== attributeId));
    },
    [attrBase],
  );

  const clearConflict = useCallback(() => setConflict(null), []);

  return { attributes, isLoading, error, conflict, refresh, create, update, reorder, remove, clearConflict };
}
