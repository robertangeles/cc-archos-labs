"use client";

import { useEffect, useState } from "react";
import {
  DIAGNOSTIC_CONTENT_STARTER,
  DiagnosticContentSchema,
  type DiagnosticContent,
} from "../../../../lib/diagnostic/content-config-shared";

// Admin editor for the AI Readiness Assessment content blob — questions,
// scoring values, risk-flag rules, priority triggers, tier boundaries,
// domain weights. One JSON textarea: paste the full DiagnosticContent
// JSON, hit save. Source ships a placeholder fallback only; real
// practitioner-calibrated content lives here in the DB (D-27).
//
// The MVP intentionally skips per-question structured editing — every
// real edit happens by hand against the spec, and JSON copy/paste is
// the fastest reviewable workflow.

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready"; isFallback: boolean }
  | { kind: "load-error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

export default function AdminDiagnosticPage() {
  const [jsonText, setJsonText] = useState<string>(
    JSON.stringify(DIAGNOSTIC_CONTENT_STARTER, null, 2),
  );
  const [parsed, setParsed] = useState<DiagnosticContent | null>(
    DIAGNOSTIC_CONTENT_STARTER,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/diagnostic-content");
        const json = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: DiagnosticContent;
              error?: string;
              isFallback?: boolean;
            }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setJsonText(JSON.stringify(json.data, null, 2));
          setParsed(json.data);
          setLoad({ kind: "ready", isFallback: !!json.isFallback });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load content.",
          });
        }
      } catch {
        if (!cancelled) {
          setLoad({ kind: "load-error", message: "Network error." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-validate on every edit so the user sees the parse error live
  // (e.g. trailing commas, wrong types). The save action also
  // validates server-side as the source of truth.
  function onJsonChange(next: string) {
    setJsonText(next);
    try {
      const raw = JSON.parse(next);
      const result = DiagnosticContentSchema.safeParse(raw);
      if (!result.success) {
        const first = result.error.issues[0];
        setValidationError(
          `${first?.path.join(".") || "field"}: ${first?.message ?? "Invalid value."}`,
        );
        setParsed(null);
      } else {
        setValidationError(null);
        setParsed(result.data);
      }
    } catch (err) {
      setValidationError(
        `JSON parse error: ${err instanceof Error ? err.message : "unknown"}`,
      );
      setParsed(null);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;
    if (!parsed) {
      setSave({ kind: "error", message: validationError ?? "Invalid JSON." });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/admin/settings/diagnostic-content", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: DiagnosticContent; error?: string }
        | null;
      if (res.ok && json?.ok) {
        setSave({ kind: "saved" });
        setLoad({ kind: "ready", isFallback: false });
        setTimeout(() => setSave({ kind: "idle" }), 2500);
        return;
      }
      setSave({
        kind: "error",
        message: json?.error ?? "Could not save.",
      });
    } catch {
      setSave({ kind: "error", message: "Network error." });
    }
  }

  return (
    <section>
      <h1 className="text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-[40px]">
        Diagnostic Content
      </h1>
      <p className="mt-4 max-w-[720px] text-base leading-[1.7] text-ink-subtle">
        The full content blob for the AI Readiness Assessment — questions,
        per-option scores, branch wiring, risk-flag rules, priority
        triggers, tier boundaries, domain weights. Edit as JSON. Changes
        apply on the next assessment + report generation. Each save
        re-evaluates priority on prior reports against the new triggers
        when the report page is re-loaded.
      </p>

      {load.kind === "loading" ? (
        <p className="mt-12 text-sm text-ink-subtle">Loading…</p>
      ) : load.kind === "load-error" ? (
        <p role="alert" className="mt-12 text-sm text-[#f87171]">
          {load.message}
        </p>
      ) : (
        <>
          {load.kind === "ready" && load.isFallback ? (
            <div className="mt-8 rounded-md border border-[#fbbf24]/40 bg-[#fbbf24]/5 px-5 py-4">
              <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#fbbf24]">
                No content configured
              </p>
              <p className="mt-2 text-sm leading-[1.6] text-ink/90">
                No admin content is saved yet — the JSON below is a
                starter template. <strong>The public assessment will
                throw a 500 error</strong> until you replace this with
                the real practitioner-calibrated content and save.
                Paste the real blob below and click Save.
              </p>
            </div>
          ) : null}

          {parsed ? <Summary content={parsed} /> : null}

          <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-y-6">
            <label className="flex flex-col gap-y-2">
              <span className={labelClass}>Version label</span>
              <input
                type="text"
                value={parsed?.version ?? ""}
                onChange={(e) => {
                  if (!parsed) return;
                  const next = { ...parsed, version: e.target.value };
                  setParsed(next);
                  setJsonText(JSON.stringify(next, null, 2));
                }}
                placeholder="e.g. v1-spec-2026-05"
                disabled={!parsed}
                className={inputClass}
              />
              <span className="text-xs leading-[1.5] text-ink-subtle">
                Free-form. Bump on any meaningful content edit so you can
                correlate report quality with content revisions.
              </span>
            </label>

            <label className="flex flex-col gap-y-2">
              <span className={labelClass}>Content JSON</span>
              <textarea
                value={jsonText}
                onChange={(e) => onJsonChange(e.target.value)}
                rows={36}
                className={`${inputClass} resize-y font-mono text-[12px] leading-[1.55]`}
                spellCheck={false}
              />
              <span className="text-xs leading-[1.5] text-ink-subtle">
                Full DiagnosticContent shape. See
                <code className="ml-1 rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-ink/80">
                  lib/diagnostic/content-config-shared.ts
                </code>{" "}
                for the Zod schema.
              </span>
            </label>

            {validationError ? (
              <p
                role="alert"
                className="rounded-md border border-[#f87171]/40 bg-[#f87171]/5 px-4 py-3 text-sm leading-[1.6] text-[#f87171]"
              >
                {validationError}
              </p>
            ) : null}

            {save.kind === "error" ? (
              <p role="alert" className="text-sm leading-[1.6] text-[#f87171]">
                {save.message}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
              <p
                className={`text-sm leading-[1.6] transition-colors duration-150 ${
                  save.kind === "saved" ? "text-primary" : "text-ink-subtle"
                }`}
              >
                {save.kind === "saved"
                  ? "Saved. Live on next assessment / report request."
                  : "Changes apply on next request."}
              </p>
              <button
                type="submit"
                disabled={save.kind === "saving" || !parsed}
                className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
              >
                {save.kind === "saving"
                  ? "Saving…"
                  : save.kind === "saved"
                    ? "Saved"
                    : "Save content"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

// Live summary stats for the parsed JSON — quick sanity check that the
// paste landed shape-correctly before saving.
function Summary({ content }: { content: DiagnosticContent }) {
  const stats = [
    { label: "Version", value: content.version },
    { label: "Questions", value: String(content.questions.length) },
    { label: "Risk flag rules", value: String(content.riskFlagRules.length) },
    {
      label: "Priority triggers",
      value: String(content.priorityTriggers.length),
    },
    { label: "Tier boundaries", value: String(content.tierBoundaries.length) },
  ];

  return (
    <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-md border border-hairline bg-surface-1 px-4 py-3"
        >
          <dt className="text-[10px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
            {s.label}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
