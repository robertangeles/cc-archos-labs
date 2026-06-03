"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PasswordInput } from "../../../password-input";

export default function ResetPasswordConfirmPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token, newPassword: password }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 3000);
        return;
      }

      setError(data?.error || "Invalid or expired reset link. Request a new one.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-[440px] px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink">Password updated</h1>
        <p className="mt-3 text-sm text-ink-subtle">
          Your password has been reset. Redirecting to sign in...
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:text-primary-hover">
          Sign in now
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[440px] px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Set new password</h1>
      <p className="mt-2 text-sm text-ink-subtle">
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          required
          minLength={8}
        />

        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          required
          minLength={8}
        />

        {error && (
          <p className="text-sm text-semantic-error">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
        >
          {loading ? "Updating..." : "Update password"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-subtle">
        Link expired?{" "}
        <Link href="/forgot-password" className="text-primary hover:text-primary-hover">
          Request a new one
        </Link>
      </p>
    </div>
  );
}
