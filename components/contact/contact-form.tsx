"use client";

import { useState } from "react";

type FormStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-colors duration-150 focus:border-primary focus:outline-none";

const labelClass = "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

export function ContactForm() {
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      organisation: String(data.get("organisation") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      website: String(data.get("website") ?? ""), // honeypot
    };

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;

      if (res.ok && json?.ok) {
        setStatus({ kind: "success" });
        form.reset();
        return;
      }

      setStatus({
        kind: "error",
        message:
          json?.error ??
          "We couldn't send your message. Please try again in a minute.",
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error. Please try again.",
      });
    }
  }

  if (status.kind === "success") {
    return (
      <div className="rounded-lg border border-semantic-success/40 bg-semantic-success/5 p-8">
        <p className="uppercase text-eyebrow text-semantic-success">
          Message sent
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.01em] text-ink">
          We&rsquo;ll be in touch.
        </h2>
        <p className="mt-3 text-base leading-[1.7] text-ink-subtle">
          We respond within one business day, usually faster. If your enquiry is
          urgent, mention it in the subject line of your reply.
        </p>
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="mt-6 text-sm text-primary transition-colors duration-150 hover:text-ink"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-y-6" noValidate>
      {/* Honeypot — hidden from users, irresistible to naive bots */}
      <div className="absolute left-[-9999px]" aria-hidden>
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>Name</span>
          <input
            type="text"
            name="name"
            required
            autoComplete="name"
            maxLength={120}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-2">
          <span className={labelClass}>Work email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            maxLength={254}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-y-2">
        <span className={labelClass}>Organisation</span>
        <input
          type="text"
          name="organisation"
          required
          autoComplete="organization"
          maxLength={200}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-y-2">
        <span className={labelClass}>What&rsquo;s on your mind?</span>
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={6}
          className={`${inputClass} resize-y`}
        />
      </label>

      {status.kind === "error" ? (
        <p
          role="alert"
          className="text-sm leading-[1.6] text-[#f87171]"
        >
          {status.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-x-4">
        <p className="text-sm leading-[1.6] text-ink-subtle">
          We respond within one business day. We don&rsquo;t pitch.
        </p>
        <button
          type="submit"
          disabled={status.kind === "submitting"}
          className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
        >
          {status.kind === "submitting" ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
