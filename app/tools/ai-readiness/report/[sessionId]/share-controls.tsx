"use client";

import { useState } from "react";
import type { ShareTokenSummary } from "../../../../../lib/share-tokens";

// Owner-only controls for minting + revoking share tokens against a
// single report. Embedded into ReportView when viewMode === "owner".
//
// Behaviour:
//   - "Create shareable link" → POST /api/diagnostic/share, prepend
//     the new token to the local list, show a copy-link row.
//   - "Copy" → writes the URL to the clipboard, shows a brief "Copied"
//     confirmation.
//   - "Revoke" → POST /api/diagnostic/share/[id]/revoke, removes the
//     row from the local list (server marks revoked_at).
//
// The list of active tokens is provided as initial server-loaded prop
// and managed locally afterwards. Refreshing the page reloads from DB.

type RenderedToken = ShareTokenSummary & { url?: string };

type Status =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "revoking"; id: string }
  | { kind: "error"; message: string };

export function ShareControls({
  sessionId,
  initialTokens,
}: {
  sessionId: string;
  initialTokens: ShareTokenSummary[];
}) {
  const [tokens, setTokens] = useState<RenderedToken[]>(initialTokens);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function onCreate() {
    if (status.kind === "minting") return;
    setStatus({ kind: "minting" });
    try {
      const res = await fetch("/api/diagnostic/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; id?: string; url?: string; expiresAt?: string; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.id || !json.url || !json.expiresAt) {
        setStatus({
          kind: "error",
          message: json?.error ?? "Could not create share link.",
        });
        return;
      }
      const fresh: RenderedToken = {
        id: json.id,
        url: json.url,
        expiresAt: new Date(json.expiresAt),
        consumedAt: null,
        createdAt: new Date(),
      };
      setTokens((prev) => [fresh, ...prev]);
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "error", message: "Network error." });
    }
  }

  async function onRevoke(id: string) {
    if (status.kind === "revoking" && status.id === id) return;
    setStatus({ kind: "revoking", id });
    try {
      const res = await fetch(`/api/diagnostic/share/${id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        setStatus({ kind: "error", message: "Could not revoke link." });
        return;
      }
      setTokens((prev) => prev.filter((t) => t.id !== id));
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "error", message: "Network error." });
    }
  }

  async function onCopy(token: RenderedToken) {
    if (!token.url) return;
    try {
      await navigator.clipboard.writeText(token.url);
      setCopiedId(token.id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === token.id ? null : cur));
      }, 1800);
    } catch {
      setStatus({ kind: "error", message: "Could not copy to clipboard." });
    }
  }

  return (
    <section className="border-t border-hairline px-6 py-12 md:px-12 md:py-16 print:hidden">
      <div className="mx-auto w-full max-w-[840px]">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
          Share this report
        </p>
        <h2 className="mt-3 text-xl font-semibold leading-[1.3] tracking-[-0.01em] text-ink md:text-[24px]">
          Forward to your CFO, board, or collaborator
        </h2>
        <p className="mt-3 max-w-[640px] text-sm leading-[1.6] text-ink-subtle">
          Each link is valid for 7 days and works without requiring the
          recipient to sign in. You can revoke a link at any time. We log
          the first time a link is opened (for your own audit) — re-views
          are not separately tracked.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            onClick={onCreate}
            disabled={status.kind === "minting"}
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
          >
            {status.kind === "minting" ? "Creating…" : "Create shareable link"}
          </button>
          {tokens.length > 0 ? (
            <span className="text-xs text-ink-subtle">
              {tokens.length} active link{tokens.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {status.kind === "error" ? (
          <p
            role="alert"
            className="mt-4 text-sm leading-[1.6] text-semantic-error"
          >
            {status.message}
          </p>
        ) : null}

        {tokens.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-y-3">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-hairline bg-surface-1 px-5 py-4"
              >
                <div className="flex flex-col gap-y-3 md:flex-row md:items-center md:justify-between md:gap-x-4">
                  <div className="min-w-0 flex-1">
                    {t.url ? (
                      <p className="truncate font-mono text-xs text-ink/90">
                        {t.url}
                      </p>
                    ) : (
                      <p className="text-xs italic text-ink-subtle">
                        Link revealed only at creation — refresh to mint a
                        fresh one if you didn&rsquo;t copy it.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                      Expires {formatDate(t.expiresAt)}
                      {t.consumedAt
                        ? ` · first opened ${formatDate(t.consumedAt)}`
                        : " · not yet opened"}
                    </p>
                  </div>
                  <div className="flex items-center gap-x-3">
                    {t.url ? (
                      <button
                        type="button"
                        onClick={() => onCopy(t)}
                        className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:border-primary/60 hover:text-primary"
                      >
                        {copiedId === t.id ? "Copied" : "Copy"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRevoke(t.id)}
                      disabled={
                        status.kind === "revoking" && status.id === t.id
                      }
                      className="text-xs font-medium text-ink-subtle underline decoration-muted/40 underline-offset-2 transition-colors duration-150 hover:text-semantic-error hover:decoration-semantic-error/60 disabled:opacity-60"
                    >
                      {status.kind === "revoking" && status.id === t.id
                        ? "Revoking…"
                        : "Revoke"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
