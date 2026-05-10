"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// Cycle the submit-button label through staged messages while the
// API call runs (~10–30s for the Claude generation). Keeps the
// form mounted so a retry doesn't lose typed values.
const SUBMITTING_STAGES = [
  "Unlocking your report…",
  "Drafting your report…",
  "Almost ready…",
] as const;
const STAGE_INTERVAL_MS = 4000;

// Registration gate per spec §7.1–§7.2.
//
// Full-screen overlay that appears AFTER the final question. Behind
// the gate sits a blurred placeholder representing the report shape
// — the report itself doesn't exist yet (Claude generation happens
// after the form is submitted), but the visual gives the same "your
// results are right behind this gate" psychological signal.
//
// Six fields per spec §7.2: First name (req), Last name (req), Work
// email (req + validated), Job title (req), Organisation (req),
// Phone (optional). Phone is explicitly labelled optional — making
// it required drops conversion per spec.
//
// Note: copy is hardcoded for W4 Pass 1. Per the
// feedback_config_tier_hierarchy memory, this should migrate to
// site_setting in a future Content & Copy admin tab.

export interface LeadInput {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  organisation: string;
  phone?: string;
}

interface Props {
  onSubmit: (lead: LeadInput) => void;
  submitting: boolean;
  errorMessage?: string;
}

export function RegistrationGate({ onSubmit, submitting, errorMessage }: Props) {
  const [form, setForm] = useState<LeadInput>({
    firstName: "",
    lastName: "",
    email: "",
    jobTitle: "",
    organisation: "",
    phone: "",
  });
  const [stage, setStage] = useState(0);

  // Reset + advance stage messages while submitting. When submitting
  // ends (success or error), reset to first stage.
  useEffect(() => {
    if (!submitting) {
      setStage(0);
      return;
    }
    const id = setInterval(() => {
      setStage((s) => Math.min(s + 1, SUBMITTING_STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [submitting]);

  function update<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    onSubmit({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      jobTitle: form.jobTitle.trim(),
      organisation: form.organisation.trim(),
      phone: form.phone?.trim() || undefined,
    });
  }

  return (
    <div className="relative flex flex-1 flex-col bg-canvas">
      {/* Blurred placeholder representing "report behind the gate".
          Shapes hint at the verdict header + risk flags + narrative
          without rendering content the user hasn't earned yet. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none px-6 pt-16 opacity-25 blur-md md:px-12 md:pt-24"
      >
        <div className="mx-auto flex w-full max-w-[840px] flex-col gap-y-8">
          <div className="h-3 w-32 rounded-full bg-accent" />
          <div className="flex items-baseline gap-x-10">
            <div className="h-28 w-44 rounded-md bg-fg/30" />
            <div className="flex flex-col gap-y-3">
              <div className="h-6 w-56 rounded bg-fg/30" />
              <div className="h-4 w-40 rounded bg-fg/20" />
            </div>
          </div>
          <div className="flex flex-col gap-y-3 pt-4">
            <div className="h-3 w-full rounded bg-fg/20" />
            <div className="h-3 w-11/12 rounded bg-fg/20" />
            <div className="h-3 w-3/4 rounded bg-fg/20" />
            <div className="h-3 w-5/6 rounded bg-fg/20" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-4">
            <div className="h-20 rounded-md bg-fg/15" />
            <div className="h-20 rounded-md bg-fg/15" />
            <div className="h-20 rounded-md bg-fg/15" />
          </div>
        </div>
      </div>

      {/* Foreground gate */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12 backdrop-blur-md md:px-12"
      >
        <div className="w-full max-w-[520px] rounded-lg border border-rule bg-surface px-6 py-8 shadow-2xl md:px-10 md:py-10">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-accent">
            Your AI readiness report
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-fg md:text-[28px]">
            Your report is ready.
          </h2>
          <p className="mt-3 text-sm leading-[1.6] text-muted">
            Create a free account to unlock it — no credit card, no pitch
            call, no obligation. Your report is generated once and stored
            securely; you can return to it any time.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 flex flex-col gap-y-4"
            noValidate
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="First name"
                name="firstName"
                required
                autoComplete="given-name"
                value={form.firstName}
                onChange={(v) => update("firstName", v)}
                disabled={submitting}
              />
              <Field
                label="Last name"
                name="lastName"
                required
                autoComplete="family-name"
                value={form.lastName}
                onChange={(v) => update("lastName", v)}
                disabled={submitting}
              />
            </div>

            <Field
              label="Work email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(v) => update("email", v)}
              disabled={submitting}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Job title"
                name="jobTitle"
                required
                autoComplete="organization-title"
                value={form.jobTitle}
                onChange={(v) => update("jobTitle", v)}
                disabled={submitting}
              />
              <Field
                label="Organisation"
                name="organisation"
                required
                autoComplete="organization"
                value={form.organisation}
                onChange={(v) => update("organisation", v)}
                disabled={submitting}
              />
            </div>

            <Field
              label="Phone (optional)"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={form.phone ?? ""}
              onChange={(v) => update("phone", v)}
              disabled={submitting}
            />

            {errorMessage ? (
              <p
                role="alert"
                className="text-sm leading-[1.5] text-[#f87171]"
              >
                {errorMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-3 inline-flex items-center justify-center rounded-md bg-accent px-7 py-3.5 text-base font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:cursor-default disabled:opacity-80"
            >
              {submitting ? SUBMITTING_STAGES[stage] : "Unlock report"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  value,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-rule bg-canvas px-3 py-2.5 text-base text-fg placeholder:text-muted/60 transition-colors duration-150 focus:border-accent focus:outline-none disabled:opacity-60"
      />
    </label>
  );
}
