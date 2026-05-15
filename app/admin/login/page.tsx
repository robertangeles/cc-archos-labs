"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-colors duration-150 focus:border-primary focus:outline-none";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

export default function AdminLoginPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    const data = new FormData(e.currentTarget);
    const password = String(data.get("password") ?? "");

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;

      if (res.ok && json?.ok) {
        router.replace("/admin/site");
        router.refresh();
        return;
      }

      setStatus({
        kind: "error",
        message: json?.error ?? "Could not sign in. Try again.",
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
      <section className="mx-auto w-full max-w-[420px] px-6 pt-32 pb-32 md:px-12">
        <p className="uppercase text-eyebrow text-ink-subtle">
          Admin
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-4xl">
          Sign in.
        </h1>
        <p className="mt-4 text-base leading-[1.6] text-ink-subtle">
          Operator access to site configuration.
        </p>

        <form onSubmit={onSubmit} className="mt-12 flex flex-col gap-y-6" noValidate>
          <label className="flex flex-col gap-y-2">
            <span className={labelClass}>Password</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              autoFocus
              className={inputClass}
            />
          </label>

          {status.kind === "error" ? (
            <p role="alert" className="text-sm leading-[1.6] text-[#f87171]">
              {status.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={status.kind === "submitting"}
            className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
          >
            {status.kind === "submitting" ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
