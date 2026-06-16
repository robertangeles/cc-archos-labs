"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes } from "lucide-react";
import type { DataModelSummary } from "@/hooks/use-models";
import type { Layer } from "@/lib/model-studio/validation";
import { ModelCanvas } from "./model-canvas";

// ============================================================================
// ModelDetailView — the client shell around the canvas. Loads the model
// (GET /api/model-studio/:id, which 404s if it is not in the caller's org, so
// org-scoping stays entirely in the already-tested API layer), shows a header
// with a layer switcher, and mounts the canvas for the active layer. Each layer
// keeps its own node positions (canvas-state is per layer), so switching is a
// clean remount of the canvas.
// ============================================================================

const LAYERS: Layer[] = ["conceptual", "logical", "physical"];
const LAYER_LABEL: Record<Layer, string> = {
  conceptual: "Conceptual",
  logical: "Logical",
  physical: "Physical",
};

type Status = "loading" | "ready" | "notfound";

export function ModelDetailView({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<DataModelSummary | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [layer, setLayer] = useState<Layer>("logical");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/model-studio/${modelId}`, {
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => null)) as
          | { ok: boolean; model?: DataModelSummary }
          | null;
        if (!active) return;
        if (res.ok && data?.ok && data.model) {
          setModel(data.model);
          setLayer(data.model.activeLayer);
          setStatus("ready");
        } else {
          setStatus("notfound");
        }
      } catch {
        if (active) setStatus("notfound");
      }
    })();
    return () => {
      active = false;
    };
  }, [modelId]);

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
        Loading model…
      </div>
    );
  }

  if (status === "notfound" || !model) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-2xl border border-hairline bg-surface-2 p-4 text-ink-subtle">
          <Boxes className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink">Model not found</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            It may have been deleted, or it belongs to another workspace.
          </p>
        </div>
        <Link
          href="/workspace/model-studio"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-ink-subtle hover:bg-surface-1/50 hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Model Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/workspace/model-studio"
            aria-label="Back to Model Studio"
            className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-1/50 hover:text-ink transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ink">{model.name}</h1>
            <p className="truncate text-xs text-ink-subtle">{model.projectName}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 rounded-lg border border-hairline bg-surface-2 p-0.5">
          {LAYERS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayer(l)}
              data-testid={`layer-${l}`}
              className={[
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                layer === l
                  ? "bg-primary/15 text-primary"
                  : "text-ink-subtle hover:text-ink",
              ].join(" ")}
            >
              {LAYER_LABEL[l]}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {/* Remount per layer so positions/edges reload cleanly for that layer. */}
        <ModelCanvas key={layer} modelId={modelId} layer={layer} />
      </div>
    </div>
  );
}
