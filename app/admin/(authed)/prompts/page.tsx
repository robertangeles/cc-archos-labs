"use client";

import { useEffect, useState } from "react";
import {
  DIAGNOSTIC_PROMPT_STARTER,
  type DiagnosticPrompt,
} from "../../../../lib/diagnostic/prompt-config-shared";

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

export default function AdminPromptsPage() {
  const [prompt, setPrompt] = useState<DiagnosticPrompt>(
    DIAGNOSTIC_PROMPT_STARTER,
  );
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/diagnostic-prompt");
        const json = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: DiagnosticPrompt;
              error?: string;
              isFallback?: boolean;
            }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setPrompt(json.data);
          setLoad({ kind: "ready", isFallback: !!json.isFallback });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load prompt.",
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/admin/settings/diagnostic-prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: DiagnosticPrompt; error?: string }
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
      <h1 className="text-headline text-ink md:text-display-md">
        Diagnostic Prompt
      </h1>
      <p className="mt-4 max-w-[720px] text-base leading-[1.7] text-ink-subtle">
        The system prompt sent to Claude on every AI Readiness Assessment
        report. Edit here to tune voice, output shape, forbidden words,
        tone-by-tier instructions. Changes apply on the next report
        generation. The prompt version is stamped onto every saved
        report so you can correlate model behaviour with prompt edits.
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
                No prompt configured
              </p>
              <p className="mt-2 text-sm leading-[1.6] text-ink/90">
                No admin prompt is saved yet — the form below is a starter
                template. <strong>Report generation will fail</strong> until
                you replace this with your real prompt and save. Paste your
                practitioner-voice prompt into the System prompt field, set
                a Version label, and click Save.
              </p>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-y-6">
            <label className="flex flex-col gap-y-2">
              <span className={labelClass}>Version label</span>
              <input
                type="text"
                value={prompt.version}
                onChange={(e) =>
                  setPrompt((p) => ({ ...p, version: e.target.value }))
                }
                placeholder="e.g. v1-practitioner-2026-05"
                className={inputClass}
              />
              <span className="text-xs leading-[1.5] text-ink-subtle">
                Free-form. Stamped onto every report_output row so you
                can correlate report quality with prompt revisions.
              </span>
            </label>

            <label className="flex flex-col gap-y-2">
              <span className={labelClass}>System prompt</span>
              <textarea
                value={prompt.systemPrompt}
                onChange={(e) =>
                  setPrompt((p) => ({ ...p, systemPrompt: e.target.value }))
                }
                rows={32}
                className={`${inputClass} resize-y font-mono text-[13px] leading-[1.55]`}
              />
              <span className="text-xs leading-[1.5] text-ink-subtle">
                Min 100 chars, max 20,000. Anything Claude needs to know
                that&rsquo;s NOT per-session — voice, output shape,
                tone-by-tier, forbidden words, industry context cues.
              </span>
            </label>

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
                  ? "Saved. Live on next report generation."
                  : "Changes apply on next report generation."}
              </p>
              <button
                type="submit"
                disabled={save.kind === "saving"}
                className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
              >
                {save.kind === "saving"
                  ? "Saving…"
                  : save.kind === "saved"
                    ? "Saved"
                    : "Save prompt"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
