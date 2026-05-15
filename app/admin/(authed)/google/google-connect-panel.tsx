"use client";

import { useState } from "react";

// Client island for the Google Calendar admin page. Renders the current
// grant status, the Connect button (which redirects to the start route),
// and a Disconnect button (POST → /api/admin/google-oauth/disconnect).

interface GoogleConnectPanelProps {
  status: "pending" | "ok" | "stale" | "not_configured";
  consultantEmail: string | null;
  displayName: string | null;
}

export function GoogleConnectPanel({
  status,
  consultantEmail,
  displayName,
}: GoogleConnectPanelProps) {
  const [busy, setBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const handleDisconnect = async () => {
    if (busy) return;
    if (!window.confirm("Disconnect Google Calendar? Booking will be disabled until you reconnect.")) {
      return;
    }
    setBusy(true);
    setDisconnectError(null);
    try {
      const res = await fetch("/api/admin/google-oauth/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Disconnect failed (${res.status}).`);
      }
      // Hard reload so the server-rendered status reflects the new state.
      window.location.reload();
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : "Disconnect failed.",
      );
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border border-hairline bg-surface-1 p-6">
      <div className="flex flex-col gap-y-4">
        <div>
          <p className="text-eyebrow uppercase text-ink-subtle">Status</p>
          <p className="mt-1 text-body text-ink">
            <StatusBadge status={status} />
          </p>
        </div>

        <div className="grid gap-y-2 text-body-sm text-ink-subtle">
          <Row label="Consultant email" value={consultantEmail ?? "—"} />
          <Row label="Display name" value={displayName ?? "—"} />
          <Row
            label="Working hours"
            value="Mon–Fri 9:00–17:00 (default; profile UI lands later)"
          />
        </div>

        {status === "ok" || status === "stale" ? (
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="/api/admin/google-oauth/start"
              className="inline-flex items-center justify-center rounded-md border border-hairline-strong bg-surface-2 px-5 py-2.5 text-button text-ink transition-colors duration-150 hover:bg-surface-3"
            >
              Reconnect
            </a>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="inline-flex items-center justify-center rounded-md border border-semantic-error/40 px-5 py-2.5 text-button text-semantic-error transition-colors duration-150 hover:bg-semantic-error/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="/api/admin/google-oauth/start"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover"
            >
              Connect Google Calendar
            </a>
          </div>
        )}

        {disconnectError ? (
          <p className="text-body-sm text-semantic-error">{disconnectError}</p>
        ) : null}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-x-4">
      <span className="text-ink-subtle">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: GoogleConnectPanelProps["status"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-x-2">
        <span className="inline-block h-2 w-2 rounded-full bg-semantic-success" />
        Connected
      </span>
    );
  }
  if (status === "stale") {
    return (
      <span className="inline-flex items-center gap-x-2 text-semantic-warning">
        <span className="inline-block h-2 w-2 rounded-full bg-semantic-warning" />
        Stale — refresh token rejected by Google. Reconnect to restore.
      </span>
    );
  }
  // pending OR not_configured
  return (
    <span className="inline-flex items-center gap-x-2 text-ink-subtle">
      <span className="inline-block h-2 w-2 rounded-full bg-ink-subtle/50" />
      Not connected
    </span>
  );
}
