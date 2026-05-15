"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-colors duration-150 focus:border-primary focus:outline-none";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

export function SignInForm({ initialError }: { initialError?: string }) {
  const [status, setStatus] = useState<Status>(
    initialError ? { kind: "error", message: initialError } : { kind: "idle" },
  );
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/auth/lead/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;

      if (res.ok && json?.ok) {
        // Always go to the check-email screen on a successful POST so
        // the page response shape doesn't reveal whether the account
        // exists. The page itself says "if we have an account for X".
        router.push(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
        return;
      }

      setStatus({
        kind: "error",
        message: json?.error ?? "Could not send a sign-in link. Try again.",
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <section className="mx-auto w-full max-w-[480px] px-6 pt-24 pb-32 md:px-12 md:pt-32">
        <p className="uppercase text-eyebrow text-ink-subtle">
          Return visitor
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-4xl">
          Open your report.
        </h1>
        <p className="mt-4 text-base leading-[1.6] text-ink-subtle">
          Enter the email you used when you ran the assessment. We&rsquo;ll send
          you a sign-in link — no password, no marketing.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-10 flex flex-col gap-y-6"
          noValidate
        >
          <label className="flex flex-col gap-y-2">
            <span className={labelClass}>Work email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              className={inputClass}
              disabled={status.kind === "submitting"}
            />
          </label>

          {status.kind === "error" ? (
            <p role="alert" className="text-sm leading-[1.6] text-semantic-error">
              {status.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={status.kind === "submitting"}
            className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
          >
            {status.kind === "submitting" ? "Sending link…" : "Send sign-in link"}
          </button>
        </form>

        <p className="mt-12 text-sm leading-[1.6] text-ink-subtle">
          Haven&rsquo;t taken the assessment yet?{" "}
          <Link
            href="/tools/ai-readiness"
            className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            Start here
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
