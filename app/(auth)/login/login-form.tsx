"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { TurnstileWidget } from "../turnstile-widget";
import { GoogleButton } from "../google-button";
import { PasswordInput } from "../password-input";

interface LoginFormProps {
  turnstileSiteKey: string | null;
  googleOauthEnabled: boolean;
}

export function LoginForm({
  turnstileSiteKey,
  googleOauthEnabled,
}: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/account";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [magicSending, setMagicSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the bot check.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error === "csrf" ? "Security check failed. Reload and try again." : data.error || "Invalid email or password.");
        return;
      }
      router.push(redirect);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first, then request a sign-in link.");
      return;
    }
    setError(null);
    setMagicSending(true);
    try {
      await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setMagicSent(true);
    } catch {
      setError("Could not send the link. Please try again.");
    } finally {
      setMagicSending(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

  if (magicSent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink">Check your email</h1>
        <p className="mt-3 text-sm text-ink-subtle">
          If an account exists for {email}, we&apos;ve sent a sign-in link.
          It expires in 15 minutes.
        </p>
        <button
          type="button"
          onClick={() => setMagicSent(false)}
          className="mt-6 text-sm text-primary hover:text-primary-hover"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
      <p className="mt-2 text-sm text-ink-subtle">
        Sign in to your Archos Labs account.
      </p>

      {googleOauthEnabled && (
        <div className="mt-6">
          <GoogleButton redirect={redirect} label="Sign in with Google" />
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-xs text-ink-subtle">or</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className={googleOauthEnabled ? "space-y-4" : "mt-8 space-y-4"}>
        <div>
          <label className="text-xs font-medium text-ink-subtle">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>

        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          required
        />

        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <button
        type="button"
        onClick={handleMagicLink}
        disabled={magicSending}
        className="mt-4 w-full text-center text-sm text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
      >
        {magicSending ? "Sending..." : "Email me a sign-in link instead"}
      </button>

      <p className="mt-6 text-center text-sm text-ink-subtle">
        Don&apos;t have an account?{" "}
        <Link href={`/register?redirect=${encodeURIComponent(redirect)}`} className="text-primary hover:text-primary-hover">
          Create one
        </Link>
      </p>
    </div>
  );
}
