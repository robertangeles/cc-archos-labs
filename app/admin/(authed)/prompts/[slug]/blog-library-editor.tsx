"use client";

import { useEffect, useState } from "react";
import type { BlogLibrary, BlogLibraryEntry } from "../../../../../lib/blog-library-shared";

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
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle";

const EMPTY_ENTRY: BlogLibraryEntry = { title: "", url: "", summary: "" };

export function BlogLibraryEditor() {
  const [entries, setEntries] = useState<BlogLibraryEntry[]>([]);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/blog-library");
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; data?: BlogLibrary; error?: string; isFallback?: boolean }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setEntries(json.data);
          setLoad({ kind: "ready", isFallback: !!json.isFallback });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load blog library.",
          });
        }
      } catch {
        if (!cancelled) {
          setLoad({ kind: "load-error", message: "Network error." });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function updateEntry(idx: number, field: keyof BlogLibraryEntry, value: string) {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    );
  }

  function removeEntry(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  function addEntry() {
    setEntries((prev) => [...prev, { ...EMPTY_ENTRY }]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;

    const cleaned = entries.filter(
      (e) => e.title.trim() && e.url.trim() && e.summary.trim(),
    );

    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/admin/settings/blog-library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cleaned),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: BlogLibrary; error?: string }
        | null;
      if (res.ok && json?.ok) {
        if (json.data) setEntries(json.data);
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
    return <p className="text-body-sm text-ink-subtle">Loading blog library…</p>;
  }
  if (load.kind === "load-error") {
    return (
      <p role="alert" className="text-body-sm text-semantic-error">
        {load.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-card-title text-ink">Blog library</h2>
        <p className="mt-1 text-body-sm text-ink-subtle">
          Posts available for Claude to match against the prospect&apos;s
          reason. Add entries here — the prompt above controls how Claude
          picks from them.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-y-4">
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline px-5 py-8 text-center text-body-sm text-ink-subtle">
            No entries yet. Add a blog post below.
          </p>
        ) : (
          <ul className="flex flex-col gap-y-4">
            {entries.map((entry, idx) => (
              <li
                key={idx}
                className="rounded-md border border-hairline bg-surface-1/30 p-4"
              >
                <div className="flex items-start justify-between gap-x-3">
                  <span className="text-eyebrow uppercase text-ink-subtle">
                    #{idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeEntry(idx)}
                    className="text-xs text-ink-subtle hover:text-semantic-error"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-y-3">
                  <label className="flex flex-col gap-y-1">
                    <span className={labelClass}>Title</span>
                    <input
                      type="text"
                      value={entry.title}
                      onChange={(e) => updateEntry(idx, "title", e.target.value)}
                      placeholder="Why most AI programs fail at the data layer"
                      maxLength={200}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-y-1">
                    <span className={labelClass}>URL</span>
                    <input
                      type="url"
                      value={entry.url}
                      onChange={(e) => updateEntry(idx, "url", e.target.value)}
                      placeholder="https://archoslabs.xyz/blog/data-layer-failures"
                      maxLength={500}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-y-1">
                    <span className={labelClass}>Summary</span>
                    <textarea
                      value={entry.summary}
                      onChange={(e) => updateEntry(idx, "summary", e.target.value)}
                      placeholder="Explores the three most common data architecture gaps that derail enterprise AI programs."
                      maxLength={500}
                      rows={2}
                      className={`${inputClass} resize-y`}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addEntry}
          className="self-start rounded-md border border-dashed border-hairline px-4 py-2 text-sm text-ink-subtle transition-colors duration-150 hover:border-hairline-strong hover:text-ink"
        >
          + Add entry
        </button>

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
              ? "Saved. Live on next booking."
              : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
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
                : "Save library"}
          </button>
        </div>
      </form>
    </div>
  );
}
