"use client";

import { useEffect, useState } from "react";
import {
  CHAT_PROMPT_STARTER,
  type ChatPrompt,
} from "../../../../../lib/chat/prompt-config-shared";

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

export function ChatPromptEditor() {
  const [prompt, setPrompt] = useState<ChatPrompt>(CHAT_PROMPT_STARTER);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/chat-prompt");
        const json = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: ChatPrompt;
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
      const res = await fetch("/api/admin/settings/chat-prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: ChatPrompt; error?: string }
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

  return (
    <>
      {load.isFallback ? (
        <div className="mb-8 rounded-md border border-semantic-warning/40 bg-semantic-warning/5 px-5 py-4">
          <p className="text-eyebrow uppercase text-semantic-warning">
            No prompt configured
          </p>
          <p className="mt-2 text-body-sm leading-[1.6] text-ink/90">
            No admin prompt is saved yet. The form below is a starter
            template. Replace it with your real workspace chat identity
            prompt and save.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>Version label</span>
          <input
            type="text"
            value={prompt.version}
            onChange={(e) =>
              setPrompt((p) => ({ ...p, version: e.target.value }))
            }
            placeholder="e.g. v1-metis-2026-06"
            className={inputClass}
          />
          <span className="text-xs leading-[1.5] text-ink-subtle">
            Free-form label for tracking which prompt version is live.
          </span>
        </label>

        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>System prompt</span>
          <textarea
            value={prompt.systemPrompt}
            onChange={(e) =>
              setPrompt((p) => ({ ...p, systemPrompt: e.target.value }))
            }
            rows={28}
            className={`${inputClass} resize-y font-mono text-[13px] leading-[1.55]`}
          />
          <span className="text-xs leading-[1.5] text-ink-subtle">
            Min 50 chars, max 20,000. Defines the assistant persona, tone,
            guardrails, and domain context for all workspace chat users.
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
              ? "Saved. Live on next chat message."
              : "Changes apply on next chat message."}
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
