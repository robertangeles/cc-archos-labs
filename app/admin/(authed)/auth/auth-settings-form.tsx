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

  const [turnstileEnabled, setTurnstileEnabled] = useState(
    initial.turnstileEnabled,
  );
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(
    initial.turnstileSiteKey,
  );
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("");
  const [publicSignupEnabled, setPublicSignupEnabled] = useState(
    initial.publicSignupEnabled,
  );
  const [googleOauthEnabled, setGoogleOauthEnabled] = useState(
    initial.googleOauthEnabled,
  );
  const [googleClientId, setGoogleClientId] = useState(initial.googleClientId);
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });

    // Build the patch — only include fields the user actually changed
    // so the empty-string-no-overwrite rule on secrets works cleanly.
    const patch: Record<string, unknown> = {
      turnstileEnabled,
      publicSignupEnabled,
      googleOauthEnabled,
    };
    if (turnstileSiteKey !== initial.turnstileSiteKey) {
      patch.turnstileSiteKey = turnstileSiteKey;
    }
    if (turnstileSecretKey.length > 0) {
      patch.turnstileSecretKey = turnstileSecretKey;
    }
    if (googleClientId !== initial.googleClientId) {
      patch.googleClientId = googleClientId;
    }
    if (googleClientSecret.length > 0) {
      patch.googleClientSecret = googleClientSecret;
    }

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
    setTurnstileSecretKey("");
    setGoogleClientSecret("");
    startTransition(() => router.refresh());
  }

  async function clearTurnstileSecret() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Clear the stored Turnstile secret? Turnstile will need to be disabled or a new secret pasted before sign-ups will work.",
      )
    ) {
      return;
    }
    setStatus({ kind: "saving" });
    const res = await fetch("/api/admin/auth-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileSecretKey: null }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setStatus({
        kind: "error",
        message: json.error ?? "Could not clear secret.",
      });
      return;
    }
    setStatus({ kind: "saved" });
    startTransition(() => router.refresh());
  }

  async function clearGoogleClientSecret() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Clear the stored Google client secret? Google sign-in will need to be disabled or a new secret pasted before sign-ins will work.",
      )
    ) {
      return;
    }
    setStatus({ kind: "saving" });
    const res = await fetch("/api/admin/auth-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ googleClientSecret: null }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setStatus({
        kind: "error",
        message: json.error ?? "Could not clear secret.",
      });
      return;
    }
    setStatus({ kind: "saved" });
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={save} className="space-y-8">
      {/* Cloudflare Turnstile section */}
      <section className="space-y-4 rounded-lg border border-hairline p-5">
        <header className="flex items-start justify-between gap-x-4">
          <div>
            <h2 className="text-base font-medium text-ink">
              Cloudflare Turnstile
            </h2>
            <p className="mt-1 text-sm text-ink-subtle">
              Bot protection on the public auth endpoints (register, login,
              password reset). Generate a key pair at{" "}
              <a
                href="https://dash.cloudflare.com/?to=/:account/turnstile"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-ink"
              >
                Cloudflare dashboard
              </a>
              .
            </p>
          </div>
          <Toggle
            label="Enabled"
            checked={turnstileEnabled}
            onChange={setTurnstileEnabled}
          />
        </header>

        <Field label="Site key" hint="Public — embedded in the frontend widget.">
          <input
            type="text"
            value={turnstileSiteKey}
            onChange={(e) => setTurnstileSiteKey(e.target.value)}
            placeholder="0x4AAAAAAA…"
            className="w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
          />
        </Field>

        <Field
          label="Secret key"
          hint={
            initial.turnstileHasSecret
              ? "A secret is stored (encrypted). Paste a new one to replace, or use Clear."
              : "Server-side secret. Used to verify Turnstile tokens with Cloudflare."
          }
          rightAction={
            initial.turnstileHasSecret ? (
              <button
                type="button"
                onClick={clearTurnstileSecret}
                disabled={isPending}
                className="text-xs text-red-700 hover:underline disabled:opacity-40"
              >
                Clear
              </button>
            ) : null
          }
        >
          <input
            type="password"
            value={turnstileSecretKey}
            onChange={(e) => setTurnstileSecretKey(e.target.value)}
            placeholder={
              initial.turnstileHasSecret ? "•••••••••• (set)" : "0x4AAAAAAA…"
            }
            autoComplete="new-password"
            className="w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
          />
        </Field>
      </section>

      {/* Google OAuth section */}
      <section className="space-y-4 rounded-lg border border-hairline p-5">
        <header className="flex items-start justify-between gap-x-4">
          <div>
            <h2 className="text-base font-medium text-ink">Google sign-in</h2>
            <p className="mt-1 text-sm text-ink-subtle">
              Lets users sign in with their Google account. Create an OAuth 2.0
              Web Application credential at{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-ink"
              >
                Google Cloud Console
              </a>
              . Authorized redirect URI:{" "}
              <code className="rounded bg-surface-1 px-1 py-0.5 text-xs">
                /api/auth/google/callback
              </code>{" "}
              on this site.
            </p>
          </div>
          <Toggle
            label="Enabled"
            checked={googleOauthEnabled}
            onChange={setGoogleOauthEnabled}
          />
        </header>

        <Field label="Client ID" hint="Public — emitted in the authorize URL.">
          <input
            type="text"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
            placeholder="123456789-…apps.googleusercontent.com"
            className="w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
          />
        </Field>

        <Field
          label="Client secret"
          hint={
            initial.googleHasClientSecret
              ? "A secret is stored (encrypted). Paste a new one to replace, or use Clear."
              : "Server-side secret. Used during the token-exchange step of the OAuth dance."
          }
          rightAction={
            initial.googleHasClientSecret ? (
              <button
                type="button"
                onClick={clearGoogleClientSecret}
                disabled={isPending}
                className="text-xs text-red-700 hover:underline disabled:opacity-40"
              >
                Clear
              </button>
            ) : null
          }
        >
          <input
            type="password"
            value={googleClientSecret}
            onChange={(e) => setGoogleClientSecret(e.target.value)}
            placeholder={
              initial.googleHasClientSecret
                ? "•••••••••• (set)"
                : "GOCSPX-…"
            }
            autoComplete="new-password"
            className="w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
          />
        </Field>
      </section>

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

function Field({
  label,
  hint,
  rightAction,
  children,
}: {
  label: string;
  hint?: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between gap-x-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
          {label}
        </span>
        {rightAction}
      </div>
      {children}
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </label>
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
