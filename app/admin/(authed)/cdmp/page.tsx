"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CDMP_CONFIG_STARTER,
  CdmpConfigSchema,
  type CdmpConfig,
} from "../../../../lib/cdmp/config-shared";

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready"; isFallback: boolean }
  | { kind: "load-error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export default function AdminCdmpConfigPage() {
  const [jsonText, setJsonText] = useState<string>(
    JSON.stringify(CDMP_CONFIG_STARTER, null, 2),
  );
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/cdmp-config");
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; data?: CdmpConfig; isFallback?: boolean }
          | null;

        if (cancelled) return;

        if (json?.ok && json.data) {
          setJsonText(JSON.stringify(json.data, null, 2));
          setLoad({
            kind: "ready",
            isFallback: json.isFallback ?? false,
          });
        } else {
          setLoad({ kind: "load-error", message: "Failed to load config" });
        }
      } catch (err) {
        if (!cancelled) {
          setLoad({
            kind: "load-error",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validationError = useMemo(() => {
    try {
      const parsed = JSON.parse(jsonText);
      const result = CdmpConfigSchema.safeParse(parsed);
      if (!result.success) {
        return result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n");
      }
      return null;
    } catch (err) {
      return (
        `JSON parse error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, [jsonText]);

  async function handleSave() {
    if (validationError) return;
    setSave({ kind: "saving" });

    try {
      const res = await fetch("/api/admin/settings/cdmp-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: jsonText,
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (json?.ok) {
        setSave({ kind: "saved" });
        setTimeout(() => setSave({ kind: "idle" }), 2000);
      } else {
        setSave({ kind: "error", message: json?.error ?? "Save failed" });
      }
    } catch (err) {
      setSave({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  let parsed: CdmpConfig | null = null;
  try {
    const p = JSON.parse(jsonText);
    if (CdmpConfigSchema.safeParse(p).success) parsed = p;
  } catch {}

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">CDMP Practice Exam Config</h2>
        <p className="mt-1 text-sm text-ink-subtle">
          Prompts, knowledge area weights, pass thresholds, and generation
          parameters. Changes take effect immediately.
        </p>
      </div>

      {load.kind === "loading" && (
        <p className="text-sm text-ink-subtle">Loading config...</p>
      )}
      {load.kind === "load-error" && (
        <p className="text-sm text-red-600">{load.message}</p>
      )}
      {load.kind === "ready" && load.isFallback && (
        <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300">
          Using starter fallback. Save to persist to the database.
        </p>
      )}

      {parsed && (
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="rounded-lg border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-ink-subtle">Knowledge areas</p>
            <p className="text-lg font-semibold text-ink">{parsed.knowledgeAreas.length}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-ink-subtle">Question counts</p>
            <p className="text-lg font-semibold text-ink">{parsed.questionCounts.join(", ")}</p>
          </div>
          <div className="rounded-lg border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-ink-subtle">Version</p>
            <p className="text-lg font-semibold text-ink">{parsed.version}</p>
          </div>
        </div>
      )}

      <div>
        <label className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
          Config JSON
        </label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={30}
          className="mt-1 w-full rounded-md border border-hairline bg-canvas px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {validationError && (
        <pre className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 whitespace-pre-wrap">
          {validationError}
        </pre>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={!!validationError || save.kind === "saving"}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {save.kind === "saving" ? "Saving..." : "Save config"}
        </button>

        {save.kind === "saved" && (
          <span className="text-sm text-green-600">Saved</span>
        )}
        {save.kind === "error" && (
          <span className="text-sm text-red-600">{save.message}</span>
        )}
      </div>
    </div>
  );
}
