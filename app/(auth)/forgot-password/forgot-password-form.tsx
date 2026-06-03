"use client";

import { useState } from "react";
import Link from "next/link";
import { TurnstileWidget } from "../turnstile-widget";

interface Props {
  turnstileSiteKey: string | null;
}

export function ForgotPasswordForm({ turnstileSiteKey }: Props) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the bot check.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok && data?.error === "csrf") {
        setError("Security check failed. Reload and try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-[440px] px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink">Check your email</h1>
        <p className="mt-3 text-sm text-ink-subtle">
          If an account exists for <strong className="text-ink">{email}</strong>,
          we sent a password reset link. It expires in 15 minutes.
        </p>
        <p className="mt-6 text-sm text-ink-subtle">
          Did not get it?{" "}
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="text-primary hover:text-primary-hover"
          >
            Try again
          </button>
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm text-ink-subtle hover:text-ink"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[440px] px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-subtle">
        Enter the email address you registered with. We will send a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="reset-email" className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-3 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />

        {error && (
          <p className="text-sm text-semantic-error">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-subtle">
        Remember your password?{" "}
        <Link href="/login" className="text-primary hover:text-primary-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
