"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AuthSettingsView } from "../../../../lib/auth/settings";

interface Props {
  initial: AuthSettingsView;
}

// Client form for authentication settings. PATCHes the auth-settings
// API, refreshes the server component on save to pick up the new state.
//
// Field behavior:
//   - Toggles: write boolean directly.
//   - Site key: empty input is treated as "no change" (so a blank field
//     doesn't accidentally clear an existing value). Use the "Clear"
//     button to explicitly null it.
//   - Secret key: same — empty input is "no change". Renders the
//     "configured" status from the initial.turnstileHasSecret flag.

export function AuthSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [publicSignupEnabled, setPublicSignupEnabled] = useState(
    initial.publicSignupEnabled,
  );

  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });

    // Build the patch — only include fields the user actually changed
    // so the empty-string-no-overwrite rule on secrets works cleanly.
    const patch: Record<string, unknown> = {
      publicSignupEnabled,
    };

    const res = await fetch("/api/admin/auth-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setStatus({
        kind: "error",
        message: json.error ?? "Could not save settings.",
      });
      return;
    }
    setStatus({ kind: "saved" });
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={save} className="space-y-8">
      {/* Turnstile + Google OAuth are managed in /admin/integrations */}

      {/* Public signup section */}
      <section className="space-y-4 rounded-lg border border-hairline p-5">
        <header className="flex items-start justify-between gap-x-4">
          <div>
            <h2 className="text-base font-medium text-ink">Public sign-up</h2>
            <p className="mt-1 text-sm text-ink-subtle">
              Controls whether the public{" "}
              <code className="rounded bg-surface-1 px-1 py-0.5 text-xs">
                /register
              </code>{" "}
              endpoint accepts new accounts. Diagnostic-flow signups are not
              affected by this toggle — they always succeed.
            </p>
          </div>
          <Toggle
            label="Enabled"
            checked={publicSignupEnabled}
            onChange={setPublicSignupEnabled}
          />
        </header>
      </section>

      <div className="flex items-center gap-x-4">
        <button
          type="submit"
          disabled={status.kind === "saving" || isPending}
          className="rounded-md bg-ink px-4 py-2 text-sm text-canvas hover:bg-ink/90 disabled:opacity-50"
        >
          {status.kind === "saving" ? "Saving…" : "Save changes"}
        </button>
        {status.kind === "saved" ? (
          <span className="text-sm text-emerald-700">Saved.</span>
        ) : null}
        {status.kind === "error" ? (
          <span className="text-sm text-red-700">{status.message}</span>
        ) : null}
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-x-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-hairline text-ink focus:ring-1 focus:ring-ink"
      />
      <span className="text-ink">{label}</span>
    </label>
  );
}
