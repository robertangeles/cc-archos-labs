"use client";

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// useModelStudioFlag — reads (and, for admins, writes) the Model Studio
// feature flag (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/client/src/hooks/useModelStudioFlag.ts) and
// ADAPTED to this repo's conventions: plain fetch against the App Router
// handler at /api/model-studio/flag (not Spresso's axios `api` wrapper), the
// `{ ok, enabled }` response envelope, and same-origin credentials so the
// org-context cookie rides along.
//
// Returns `{ enabled, isLoading, refresh, setEnabled }`.
//  - ModelStudioPage renders the "Coming soon" stub when OFF / loading, the
//    empty-state launch page when ON.
//  - `setEnabled` is owner|admin-only on the server; others get 403 (thrown as
//    a plain Error for the caller to surface).
// ============================================================================

interface FlagResponse {
  ok: boolean;
  enabled?: boolean;
  error?: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useModelStudioFlag() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/model-studio/flag", {
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as FlagResponse | null;
      setEnabled(Boolean(res.ok && data?.ok && data.enabled));
    } catch {
      // Treat any network failure as OFF — the page falls back to the stub
      // rather than exposing the feature on an unverified state.
      setEnabled(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial flag fetch on mount
    void refresh();
  }, [refresh]);

  const setEnabledRemote = useCallback(async (next: boolean): Promise<boolean> => {
    const res = await fetch("/api/model-studio/flag", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const data = (await res.json().catch(() => null)) as FlagResponse | null;
    if (!res.ok || !data?.ok || typeof data.enabled !== "boolean") {
      throw new Error(await readError(res, "Could not update Model Studio."));
    }
    setEnabled(data.enabled);
    return data.enabled;
  }, []);

  return { enabled, isLoading, refresh, setEnabled: setEnabledRemote };
}
