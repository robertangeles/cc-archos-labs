"use client";

import { useEffect, useState } from "react";
import {
  JUDGE_PROMPT_STARTER,
  PLAN_PROMPT_STARTER,
  type JudgePrompt,
} from "../../../../../lib/blog-agent/config-shared";

// Editor for the blog agent's two prompts. They share a schema
// (PlanPromptSchema IS JudgePromptSchema), so they share a component.

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

const COPY = {
  judge: {
    starter: JUDGE_PROMPT_STARTER,
    hint: "The rubric the independent editor grades every draft against. It sees the research alongside the draft, and every finding it reports must quote the offending sentence — a finding it cannot quote is discarded rather than believed.",
    applies: "Applies to the next draft the agent writes.",
    warning:
      "Loosening this is how slop reaches the site. Tighten freely; loosen only after reading a post you disagreed with it about.",
  },
  plan: {
    starter: PLAN_PROMPT_STARTER,
    hint: "The brief that turns research into a batch of article topics. Each item it returns becomes one queued post.",
    applies: "Applies to the next batch generated when the queue runs low.",
    warning:
      "Changes here shape what gets written for weeks, because a batch is generated once and drains slowly.",
  },
} as const;

export function BlogAgentPromptEditor({ kind }: { kind: "judge" | "plan" }) {
  const copy = COPY[kind];
  const [prompt, setPrompt] = useState<JudgePrompt>(copy.starter);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  const endpoint = `/api/admin/settings/blog-agent-prompt/${kind}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint);
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; data?: JudgePrompt; error?: string; isFallback?: boolean }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setPrompt(json.data);
          setLoad({ kind: "ready", isFallback: !!json.isFallback });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load the prompt.",
          });
        }
      } catch {
        if (!cancelled) setLoad({ kind: "load-error", message: "Network error." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
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
            Running on the starter
          </p>
          <p className="mt-2 text-body-sm leading-[1.6] text-ink/90">
            Nothing is saved for this prompt, so the agent is using the built-in
            starter below. That is a working default, not a broken state — save
            to take ownership of it.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>Version label</span>
          <input
            type="text"
            value={prompt.version}
            onChange={(e) => setPrompt((p) => ({ ...p, version: e.target.value }))}
            placeholder="e.g. v2-stricter-grounding"
            className={inputClass}
          />
          <span className="text-xs leading-[1.5] text-ink-subtle">
            Free-form. Recorded nowhere automatically, so make it mean something
            to you when you are comparing two weeks of output.
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
            {copy.hint} Min 50 characters, max 20,000.
          </span>
        </label>

        <p className="text-xs leading-[1.5] text-semantic-warning/90">
          {copy.warning}
        </p>

        {save.kind === "error" ? (
          <p role="alert" className="text-body-sm text-semantic-error">
            {save.message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
          <p
            className={`text-body-sm transition-colors duration-150 ${
              save.kind === "saved" ? "text-semantic-success" : "text-ink-subtle"
            }`}
          >
            {save.kind === "saved" ? `Saved. ${copy.applies}` : copy.applies}
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
