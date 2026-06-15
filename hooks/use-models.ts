"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelCreate, ModelUpdate } from "@/lib/model-studio/validation";

// ============================================================================
// useModels — Model Studio list-view data hook (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/client/src/hooks/useModels.ts) and ADAPTED to
// this repo's conventions: plain fetch against the App Router handlers under
// app/api/model-studio (not Spresso's axios `api` wrapper), the `{ ok, ... }`
// response envelope used across this codebase, and same-origin credentials so
// the org-context cookie rides along. No toast library exists here, so the
// hook surfaces errors as state / thrown Errors and leaves user feedback to the
// calling component (mirroring components/projects/projects-view.tsx).
// ============================================================================

/** One model row as returned by the API, enriched with its place in the
 *  Organisation → Client → Project hierarchy. Shape matches the server's
 *  `modelSelection` in lib/model-studio/service.ts exactly. */
export interface DataModelSummary {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  description: string | null;
  activeLayer: "conceptual" | "logical" | "physical";
  notation: "ie" | "idef1x";
  originDirection: "greenfield" | "existing_system";
  metadata: Record<string, unknown>;
  tags: string[];
  lastExportedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Provenance hydrated by the server so the UI can always show "who owns it".
  projectName: string;
  clientId: string | null;
  clientName: string | null;
  ownerName: string | null;
}

interface ListResponse {
  ok: boolean;
  models?: DataModelSummary[];
  total?: number;
  error?: string;
}

interface ModelResponse {
  ok: boolean;
  model?: DataModelSummary;
  error?: string;
}

/** Read the server `error` message from a failed `{ ok: false }` response, or
 *  fall back to a plain-language default — never a raw exception. */
async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useModels() {
  const [models, setModels] = useState<DataModelSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `isLoading` starts true and is only ever flipped off here, so the loading
  // skeleton shows on the initial mount but a post-mutation refresh never
  // re-flashes it — create/update/remove already apply optimistic updates, and
  // refresh just reconciles against the server.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/model-studio", { credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not load models. Please try again.");
        setModels([]);
        setTotal(0);
        return;
      }
      setError(null);
      setModels(data.models ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Something went wrong loading models. Please try again.");
      setModels([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: ModelCreate): Promise<DataModelSummary> => {
      const res = await fetch("/api/model-studio", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => null)) as ModelResponse | null;
      if (!res.ok || !data?.ok || !data.model) {
        throw new Error(await readError(res, "Could not create the model."));
      }
      const created = data.model;
      setModels((prev) => [created, ...prev]);
      setTotal((t) => t + 1);
      return created;
    },
    [],
  );

  const update = useCallback(
    async (id: string, patch: ModelUpdate): Promise<DataModelSummary> => {
      const res = await fetch(`/api/model-studio/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as ModelResponse | null;
      if (!res.ok || !data?.ok || !data.model) {
        throw new Error(await readError(res, "Could not update the model."));
      }
      const updated = data.model;
      setModels((prev) => prev.map((m) => (m.id === id ? updated : m)));
      return updated;
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/model-studio/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error(await readError(res, "Could not delete the model."));
    }
    setModels((prev) => prev.filter((m) => m.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  return { models, total, isLoading, error, refresh, create, update, remove };
}
