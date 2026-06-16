"use client";

import { useCallback, useEffect, useState } from "react";
import type { EntityRow, VersionConflict } from "@/lib/model-studio/canvas-types";
import type { EntityCreate, EntityUpdate } from "@/lib/model-studio/canvas-validation";
import type { Layer } from "@/lib/model-studio/validation";

// ============================================================================
// useEntities — canvas entity data hook. Mirrors hooks/use-models.ts: plain
// fetch, same-origin credentials (org cookie rides), useState only, optimistic
// local mutate then reconcile. A stale optimistic-lock PATCH (409
// VERSION_CONFLICT) is surfaced as `conflict` so the component can prompt a
// refresh rather than swallowing the error.
// ============================================================================

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useEntities(modelId: string, layer?: Layer) {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const base = `/api/model-studio/${modelId}/entities`;

  const refresh = useCallback(async () => {
    try {
      const url = layer ? `${base}?layer=${layer}` : base;
      const res = await fetch(url, { credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; entities?: EntityRow[]; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not load entities. Please try again.");
        setEntities([]);
        return;
      }
      setError(null);
      setEntities(data.entities ?? []);
    } catch {
      setError("Something went wrong loading entities. Please try again.");
      setEntities([]);
    } finally {
      setIsLoading(false);
    }
  }, [base, layer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: EntityCreate): Promise<EntityRow> => {
      const res = await fetch(base, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; entity?: EntityRow; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.entity) {
        throw new Error(await readError(res, "Could not create the entity."));
      }
      setEntities((prev) => [...prev, data.entity!]);
      return data.entity;
    },
    [base],
  );

  const update = useCallback(
    async (entityId: string, patch: EntityUpdate): Promise<EntityRow | null> => {
      const res = await fetch(`${base}/${entityId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; entity?: EntityRow; code?: string; serverVersion?: number; error?: string }
        | null;
      if (res.status === 409 && data?.code === "VERSION_CONFLICT") {
        setConflict({ serverVersion: data.serverVersion ?? 0 });
        return null;
      }
      if (!res.ok || !data?.ok || !data.entity) {
        throw new Error(await readError(res, "Could not update the entity."));
      }
      setEntities((prev) => prev.map((e) => (e.id === entityId ? data.entity! : e)));
      return data.entity;
    },
    [base],
  );

  const remove = useCallback(
    async (entityId: string): Promise<void> => {
      const res = await fetch(`${base}/${entityId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Could not delete the entity."));
      }
      setEntities((prev) => prev.filter((e) => e.id !== entityId));
    },
    [base],
  );

  const clearConflict = useCallback(() => setConflict(null), []);

  return { entities, isLoading, error, conflict, refresh, create, update, remove, clearConflict };
}
