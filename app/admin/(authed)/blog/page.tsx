"use client";

import { useEffect, useState } from "react";

// Admin /admin/blog — currently a single toggle for the public /blog
// surface. Phase D adds the per-post admin (status, visibility,
// needs_review queue) into this same page.

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "load-error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export default function AdminBlogPage() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/blog-enabled");
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; enabled?: boolean; error?: string }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && typeof json.enabled === "boolean") {
          setEnabled(json.enabled);
          setLoad({ kind: "ready" });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load setting.",
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

  async function toggle() {
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });
    const next = !enabled;
    try {
      const res = await fetch("/api/admin/settings/blog-enabled", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; enabled?: boolean; error?: string }
        | null;
      if (res.ok && json?.ok && typeof json.enabled === "boolean") {
        setEnabled(json.enabled);
        setSave({ kind: "saved" });
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
      <h1 className="text-headline text-ink md:text-display-md">Blog</h1>
      <p className="mt-4 max-w-[600px] text-base leading-[1.7] text-ink-subtle">
        The Translation Layer — public /blog surface. Toggle controls
        whether /blog, /blog/[slug], /blog/category/[slug], /llms.txt,
        and /llms-full.txt are reachable. Sitemap entries follow the
        same flag. Default is OFF so the migration can land without
        exposing the section until you&rsquo;re ready.
      </p>

      {load.kind === "loading" ? (
        <p className="mt-12 text-sm text-ink-subtle">Loading…</p>
      ) : load.kind === "load-error" ? (
        <p role="alert" className="mt-12 text-sm text-semantic-error">
          {load.message}
        </p>
      ) : (
        <div className="mt-12 flex flex-col gap-y-6">
          <div className="flex items-center justify-between gap-x-6 rounded-md border border-hairline bg-surface-1 px-5 py-4">
            <div>
              <p className="text-body text-ink">
                Public /blog visible
              </p>
              <p className="mt-1 text-body-sm text-ink-subtle">
                {enabled
                  ? "Live. /blog and child routes render to anyone."
                  : "Hidden. /blog and child routes 404 publicly."}
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              disabled={save.kind === "saving"}
              aria-pressed={enabled}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 disabled:opacity-60 ${
                enabled ? "bg-primary" : "bg-surface-3"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-150 ${
                  enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <p
            className={`text-sm leading-[1.6] transition-colors duration-150 ${
              save.kind === "saved"
                ? "text-semantic-success"
                : save.kind === "error"
                  ? "text-semantic-error"
                  : "text-ink-subtle"
            }`}
          >
            {save.kind === "saved"
              ? "Saved. Live on next page request."
              : save.kind === "error"
                ? save.message
                : "Changes apply on next page request."}
          </p>
        </div>
      )}
    </section>
  );
}
