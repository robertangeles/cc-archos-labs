"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_PROMPTS_STARTER,
  type BookingPromptKind,
  type BookingPrompts,
} from "../../../../../lib/booking-prompts-shared";

// Single-prompt editor backed by the all-three booking_prompts row.
// Fetches the full row, lets the admin edit ONE sub-prompt (matching
// the slug they're on), then PUTs the full row back so the other two
// are preserved. One DB row = one transaction, regardless of which
// sub-prompt is being edited.

interface BookingPromptEditorProps {
  promptKey: BookingPromptKind;
}

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

export function BookingPromptEditor({
  promptKey,
}: BookingPromptEditorProps) {
  // Hold the full row in state so PUT can write all three sub-prompts
  // back even when the admin only edited one of them.
  const [allPrompts, setAllPrompts] = useState<BookingPrompts>(
    BOOKING_PROMPTS_STARTER,
  );
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/booking-prompts");
        const json = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: BookingPrompts;
              error?: string;
              isFallback?: boolean;
            }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setAllPrompts(json.data);
          setLoad({ kind: "ready", isFallback: !!json.isFallback });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load prompts.",
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
      const res = await fetch("/api/admin/settings/booking-prompts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(allPrompts),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: BookingPrompts; error?: string }
        | null;
      if (res.ok && json?.ok) {
        setSave({ kind: "saved" });
        setLoad({ kind: "ready", isFallback: false });
        setTimeout(() => setSave({ kind: "idle" }), 2500);
        return;
      }
      setSave({ kind: "error", message: json?.error ?? "Could not save." });
    } catch {
      setSave({ kind: "error", message: "Network error." });
    }
  }

  if (load.kind === "loading") {
    return <p className="text-body-sm text-ink-subtle">Loading…</p>;
  }
  if (load.kind === "load-error") {
    return (
      <p role="alert" className="text-body-sm text-semantic-error">
        {load.message}
      </p>
    );
  }

  const current = allPrompts[promptKey];
  const isStarter =
    !current.version || current.version === "starter-v0";

  return (
    <>
      {isStarter ? (
        <div className="mb-8 rounded-md border border-hairline bg-surface-1 px-5 py-4">
          <p className="text-eyebrow uppercase text-ink-subtle">
            Using starter version
          </p>
          <p className="mt-2 text-body-sm leading-[1.6] text-ink/90">
            This prompt is still on the hardcoded starter (used as the
            runtime fallback). Edit and save to override it. Booking
            flow keeps working either way.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>Version label</span>
          <input
            type="text"
            value={current.version}
            onChange={(e) =>
              setAllPrompts((p) => ({
                ...p,
                [promptKey]: { ...p[promptKey], version: e.target.value },
              }))
            }
            placeholder="e.g. v1-2026-05"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>System prompt</span>
          <textarea
            value={current.systemPrompt}
            onChange={(e) =>
              setAllPrompts((p) => ({
                ...p,
                [promptKey]: {
                  ...p[promptKey],
                  systemPrompt: e.target.value,
                },
              }))
            }
            rows={24}
            className={`${inputClass} resize-y font-mono text-[13px] leading-[1.55]`}
          />
          <span className="text-xs leading-[1.5] text-ink-subtle">
            Min 50 chars, max 20,000.
          </span>
        </label>

        {save.kind === "error" ? (
          <p role="alert" className="text-body-sm text-semantic-error">
            {save.message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
          <p
            className={`text-body-sm transition-colors duration-150 ${
              save.kind === "saved"
                ? "text-semantic-success"
                : "text-ink-subtle"
            }`}
          >
            {save.kind === "saved"
              ? "Saved. Live on next call."
              : "Changes apply on next call."}
          </p>
          <button
            type="submit"
            disabled={save.kind === "saving"}
            className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
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
  );
}
