"use client";

import { useCallback, useEffect, useState } from "react";
import type { RelationshipRow, VersionConflict } from "@/lib/model-studio/canvas-types";
import type {
  RelationshipCreate,
  RelationshipUpdate,
} from "@/lib/model-studio/canvas-validation";

// ============================================================================
// useRelationships — canvas relationship data hook. Same conventions as
// use-entities: plain fetch, optimistic local state, 409 VERSION_CONFLICT
// surfaced as `conflict`. Lists all edges for the model; the canvas draws only
// those whose both endpoints are visible on the active layer.
// ============================================================================

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useRelationships(modelId: string) {
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const base = `/api/model-studio/${modelId}/relationships`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; relationships?: RelationshipRow[]; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not load relationships. Please try again.");
        setRelationships([]);
        return;
      }
      setError(null);
      setRelationships(data.relationships ?? []);
    } catch {
      setError("Something went wrong loading relationships. Please try again.");
      setRelationships([]);
    } finally {
      setIsLoading(false);
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: RelationshipCreate): Promise<RelationshipRow> => {
      const res = await fetch(base, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; relationship?: RelationshipRow; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.relationship) {
        throw new Error(await readError(res, "Could not create the relationship."));
      }
      setRelationships((prev) => [...prev, data.relationship!]);
      return data.relationship;
    },
    [base],
  );

  const update = useCallback(
    async (
      relationshipId: string,
      patch: RelationshipUpdate,
    ): Promise<RelationshipRow | null> => {
      const res = await fetch(`${base}/${relationshipId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; relationship?: RelationshipRow; code?: string; serverVersion?: number; error?: string }
        | null;
      if (res.status === 409 && data?.code === "VERSION_CONFLICT") {
        setConflict({ serverVersion: data.serverVersion ?? 0 });
        return null;
      }
      if (!res.ok || !data?.ok || !data.relationship) {
        throw new Error(await readError(res, "Could not update the relationship."));
      }
      setRelationships((prev) =>
        prev.map((r) => (r.id === relationshipId ? data.relationship! : r)),
      );
      return data.relationship;
    },
    [base],
  );

  const remove = useCallback(
    async (relationshipId: string): Promise<void> => {
      const res = await fetch(`${base}/${relationshipId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Could not delete the relationship."));
      }
      setRelationships((prev) => prev.filter((r) => r.id !== relationshipId));
    },
    [base],
  );

  const clearConflict = useCallback(() => setConflict(null), []);

  return { relationships, isLoading, error, conflict, refresh, create, update, remove, clearConflict };
}
