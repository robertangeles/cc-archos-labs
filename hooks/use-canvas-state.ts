"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasStateRow } from "@/lib/model-studio/canvas-types";
import type { Layer } from "@/lib/model-studio/validation";

// ============================================================================
// useCanvasState — per-user, per-layer node positions + viewport. Fetches once
// on mount/layer change and exposes a 500ms-debounced save() so dragging a node
// or panning the viewport coalesces into one PUT. Save failures are
// non-destructive: the in-memory positions stay, so the canvas never jumps.
// ============================================================================

interface SavePayload {
  nodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
  notation?: "ie" | "idef1x";
}

const SAVE_DEBOUNCE_MS = 500;

export function useCanvasState(modelId: string, layer: Layer) {
  const [state, setState] = useState<CanvasStateRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const base = `/api/model-studio/${modelId}/canvas-state`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<SavePayload | null>(null);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading before the per-layer refetch
    setIsLoading(true);
    (async () => {
      try {
        const res = await fetch(`${base}?layer=${layer}`, { credentials: "same-origin" });
        const data = (await res.json().catch(() => null)) as
          | { ok: boolean; state?: CanvasStateRow }
          | null;
        if (active && res.ok && data?.ok && data.state) {
          setState(data.state);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [base, layer]);

  const flush = useCallback(async () => {
    const payload = pending.current;
    if (!payload) return;
    pending.current = null;
    try {
      await fetch(base, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layer, ...payload }),
      });
      // Non-destructive on failure: keep the in-memory positions either way.
    } catch {
      /* swallow — positions remain in memory; next save retries */
    }
  }, [base, layer]);

  const save = useCallback(
    (next: SavePayload) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush any pending save on unmount so a quick navigate-away doesn't lose it.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return { state, isLoading, save };
}
