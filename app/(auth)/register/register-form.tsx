"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TurnstileWidget } from "../turnstile-widget";
import { GoogleButton } from "../google-button";
import { PasswordInput } from "../password-input";

interface RegisterFormProps {
  turnstileSiteKey: string | null;
  googleOauthEnabled: boolean;
}

export function RegisterForm({
  turnstileSiteKey,
  googleOauthEnabled,
}: RegisterFormProps) {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/account";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptTos, setAcceptTos] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!acceptTos) {
      setError("You must accept the Terms of Service.");
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the bot check.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          acceptTos,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error === "csrf" ? "Security check failed. Reload and try again." : data.error || "Registration failed.");
        return;
      }
      setRegistered(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

  if (registered) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink">Check your email</h1>
        <p className="mt-3 text-sm text-ink-subtle">
          We&apos;ve sent a verification link to <strong className="text-ink">{email}</strong>.
          Click the link to verify your email and activate your account.
        </p>
        <p className="mt-2 text-sm text-ink-subtle">
          The link expires in 24 hours.
        </p>
        <Link
          href={redirect}
          className="mt-6 inline-block text-sm text-primary hover:text-primary-hover"
        >
          Continue to the site (verify later)
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">
        Create your Archos Labs account
      </h1>
      <p className="mt-2 text-sm text-ink-subtle">
        One account for every Archos Labs tool.
      </p>

      {googleOauthEnabled && (
        <div className="mt-6">
          <GoogleButton redirect={redirect} label="Sign up with Google" />
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-xs text-ink-subtle">or</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className={googleOauthEnabled ? "space-y-4" : "mt-8 space-y-4"}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-ink-subtle">First name</label>
            <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-subtle">Last name</label>
            <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-ink-subtle">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>

        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          required
          showStrength
        />

        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          required
        />

        <label className="flex items-start gap-2.5 text-sm text-ink-subtle">
          <input
            type="checkbox"
            checked={acceptTos}
            onChange={(e) => setAcceptTos(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-primary"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="text-primary hover:text-primary-hover">
              Terms of Service
            </Link>
            .
          </span>
        </label>

        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-subtle">
        Already have an account?{" "}
        <Link href={`/login?redirect=${encodeURIComponent(redirect)}`} className="text-primary hover:text-primary-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
