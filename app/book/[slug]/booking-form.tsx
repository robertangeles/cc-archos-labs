"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";

// Public Book-a-Call form. Multi-step flow:
//
//   1. Slot picker — date column on the left, time slots on the right.
//      Slots are loaded from /api/booking/[slug]/availability on mount.
//   2. Intake form — name, email, organisation, position, reason.
//      After the prospect types the reason and tabs out, we POST to
//      /api/booking/intake-followup; Claude may return ONE follow-up
//      question we render inline.
//   3. Anti-spam — Turnstile widget (when configured) + honeypot field.
//   4. Submit — POST /api/booking/[slug]/create. On success, navigate
//      to /book/[slug]/confirmation/[bookingId].
//
// Failure handling: every fetch is wrapped, the UI surfaces a calm
// inline error instead of a crash. Slot conflict (409) silently
// refreshes the slot list and asks the prospect to pick again.

interface AvailableSlotWire {
  startUtc: string;
  endUtc: string;
}

interface BookingFormProps {
  slug: string;
  consultant: {
    displayName: string;
    slotMinutes: number;
    timezone: string;
  };
  turnstileSiteKey: string | null;
}

// Cloudflare Turnstile attaches a global `turnstile` object once the
// widget script loads. We render the widget into a div by id and read
// the token back via its `getResponse(elementId)` API on submit.
declare global {
  interface Window {
    turnstile?: {
      render: (
        selector: string | HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
        },
      ) => string;
      getResponse: (widgetId?: string) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

export function BookingForm({
  slug,
  consultant,
  turnstileSiteKey,
}: BookingFormProps) {
  // Slot picker state -------------------------------------------------------
  const [slots, setSlots] = useState<AvailableSlotWire[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlotWire | null>(
    null,
  );
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [freebusyOk, setFreebusyOk] = useState(true);

  // Detect prospect's timezone client-side. Used in the slot labels,
  // the create payload, and the confirmation email.
  const prospectTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  // Group slots by local date for the date-column UI.
  const slotsByDate = useMemo(() => groupSlotsByDate(slots, prospectTimezone), [
    slots,
    prospectTimezone,
  ]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/booking/${slug}/availability`);
        if (!resp.ok) {
          throw new Error(`Could not load availability (${resp.status}).`);
        }
        const body = await resp.json();
        if (cancelled) return;
        const fetchedSlots = (body.slots ?? []) as AvailableSlotWire[];
        setSlots(fetchedSlots);
        setFreebusyOk(body.freebusyOk !== false);
        // Auto-select the first date so the right column isn't empty.
        const dates = Object.keys(groupSlotsByDate(fetchedSlots, prospectTimezone));
        if (dates[0]) setSelectedDate(dates[0]);
      } catch (err) {
        if (!cancelled) {
          setSlotsError(err instanceof Error ? err.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, prospectTimezone]);

  // Intake form state ------------------------------------------------------
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [position, setPosition] = useState("");
  const [reasonInitial, setReasonInitial] = useState("");
  const [followupQuestion, setFollowupQuestion] = useState<string | null>(null);
  const [followupAnswer, setFollowupAnswer] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupRequested, setFollowupRequested] = useState(false);

  // Honeypot — visually hidden, screen-reader hidden, autocomplete off.
  const [website, setWebsite] = useState("");

  // Turnstile widget id (returned by turnstile.render) so we can read +
  // reset it on submit / error.
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);

  // Submit state ----------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Render Turnstile once the script loads + the container is in the DOM.
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileReady) return;
    if (!turnstileContainerRef.current) return;
    if (turnstileWidgetIdRef.current) return; // already rendered
    if (!window.turnstile) return;
    const id = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      theme: "dark",
    });
    turnstileWidgetIdRef.current = id;
  }, [turnstileSiteKey, turnstileReady]);

  // Trigger conversational follow-up after the prospect leaves the
  // reason field (and only if they typed something non-trivial). The
  // result is rendered inline — Claude may say "no follow-up needed."
  async function handleReasonBlur() {
    const text = reasonInitial.trim();
    if (text.length < 12) return; // too short to be useful
    if (followupRequested) return; // one shot per session
    setFollowupRequested(true);
    setFollowupLoading(true);
    try {
      const resp = await fetch("/api/booking/intake-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonInitial: text }),
      });
      const body = await resp.json();
      const f = body.followup;
      if (f?.shouldFollowUp && f?.question) {
        setFollowupQuestion(f.question);
      }
    } catch {
      // Silent fail — the form proceeds without the follow-up.
    } finally {
      setFollowupLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedSlot) {
      setSubmitError("Pick a time slot first.");
      return;
    }
    if (!name.trim() || !email.trim() || !reasonInitial.trim()) {
      setSubmitError("Name, email, and reason are required.");
      return;
    }

    setSubmitting(true);

    const turnstileToken =
      turnstileSiteKey && window.turnstile && turnstileWidgetIdRef.current
        ? window.turnstile.getResponse(turnstileWidgetIdRef.current)
        : "";

    if (turnstileSiteKey && !turnstileToken) {
      setSubmitError("Complete the bot check above the submit button.");
      setSubmitting(false);
      return;
    }

    const payload = {
      slotStartUtc: selectedSlot.startUtc,
      slotEndUtc: selectedSlot.endUtc,
      name: name.trim(),
      email: email.trim(),
      organisation: organisation.trim() || null,
      position: position.trim() || null,
      reasonInitial: reasonInitial.trim(),
      reasonFollowups:
        followupQuestion && followupAnswer.trim()
          ? [{ question: followupQuestion, answer: followupAnswer.trim() }]
          : [],
      prospectTimezone,
      utm: {
        source: getQueryParam("utm_source"),
        medium: getQueryParam("utm_medium"),
        campaign: getQueryParam("utm_campaign"),
        content: getQueryParam("utm_content"),
        term: getQueryParam("utm_term"),
        referrer: typeof document !== "undefined" ? document.referrer : null,
      },
      website, // honeypot — server expects empty
      turnstileToken,
    };

    try {
      const resp = await fetch(`/api/booking/${slug}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await resp.json();
      if (resp.ok && body.ok) {
        window.location.href = `/book/${slug}/confirmation/${body.bookingId}`;
        return;
      }
      if (resp.status === 409 && body.slots) {
        // Slot taken — refresh + ask user to pick another.
        setSlots(body.slots);
        setSelectedSlot(null);
        setSubmitError("That slot was just taken. Pick another below.");
        // Reset Turnstile so a fresh token gets minted on the next submit.
        if (window.turnstile && turnstileWidgetIdRef.current) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        }
      } else {
        setSubmitError(body.error ?? "Could not book. Try again.");
        if (window.turnstile && turnstileWidgetIdRef.current) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        }
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Network error. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Render ----------------------------------------------------------------
  const dateKeys = Object.keys(slotsByDate);

  return (
    <>
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}
      <form
        onSubmit={handleSubmit}
        className="grid gap-8"
        noValidate
        aria-label="Book a call"
      >
        {/* Slot picker */}
        <section className="rounded-md border border-hairline bg-surface-1 p-6">
          <h2 className="text-card-title text-ink">Pick a time</h2>
          <p className="mt-1 text-body-sm text-ink-subtle">
            Times shown in <span className="text-ink">{prospectTimezone}</span>.
            {consultant.timezone !== prospectTimezone ? (
              <>
                {" "}Consultant is in {consultant.timezone}.
              </>
            ) : null}
          </p>

          {!freebusyOk ? (
            <p className="mt-3 rounded-md border border-semantic-warning/40 bg-semantic-warning/5 px-3 py-2 text-body-sm text-semantic-warning">
              Calendar sync delayed — some times may already be taken. We&apos;ll let you know within minutes if your pick collides.
            </p>
          ) : null}

          {slotsLoading ? (
            <p className="mt-6 text-body-sm text-ink-subtle">Loading available times…</p>
          ) : slotsError ? (
            <p className="mt-6 text-body-sm text-semantic-error">{slotsError}</p>
          ) : dateKeys.length === 0 ? (
            <p className="mt-6 text-body-sm text-ink-subtle">
              No times available in the next {consultant.slotMinutes >= 60 ? "two weeks" : "fortnight"}. Email us instead.
            </p>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-[200px_1fr]">
              <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-2">
                {dateKeys.map((dateKey) => {
                  const isSelected = selectedDate === dateKey;
                  return (
                    <li key={dateKey}>
                      <button
                        type="button"
                        onClick={() => setSelectedDate(dateKey)}
                        className={`block w-full rounded-md px-3 py-2 text-left text-body-sm transition-colors duration-150 ${
                          isSelected
                            ? "bg-surface-2 text-ink"
                            : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
                        }`}
                      >
                        {formatDateLabel(dateKey, prospectTimezone)}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex max-h-72 flex-wrap content-start gap-2 overflow-y-auto">
                {(selectedDate ? slotsByDate[selectedDate] ?? [] : []).map(
                  (slot) => {
                    const isSelected = selectedSlot?.startUtc === slot.startUtc;
                    return (
                      <button
                        key={slot.startUtc}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-md border px-3 py-2 text-body-sm transition-colors duration-150 ${
                          isSelected
                            ? "border-primary bg-primary text-on-primary"
                            : "border-hairline text-ink hover:border-hairline-strong"
                        }`}
                      >
                        {formatTimeLabel(slot.startUtc, prospectTimezone)}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </section>

        {/* Intake form — only shown when a slot is selected */}
        {selectedSlot ? (
          <section className="rounded-md border border-hairline bg-surface-1 p-6">
            <h2 className="text-card-title text-ink">Your details</h2>
            <p className="mt-1 text-body-sm text-ink-subtle">
              {formatSlotLabel(selectedSlot, prospectTimezone)} ·{" "}
              {consultant.slotMinutes} min on Google Meet
            </p>

            <div className="mt-6 grid gap-5">
              <Field label="Name" htmlFor="bk-name">
                <input
                  id="bk-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Email" htmlFor="bk-email">
                <input
                  id="bk-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Organisation" htmlFor="bk-org" optional>
                  <input
                    id="bk-org"
                    type="text"
                    autoComplete="organization"
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Role" htmlFor="bk-pos" optional>
                  <input
                    id="bk-pos"
                    type="text"
                    autoComplete="organization-title"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field
                label="What would you like to discuss?"
                htmlFor="bk-reason"
              >
                <textarea
                  id="bk-reason"
                  required
                  rows={4}
                  value={reasonInitial}
                  onChange={(e) => setReasonInitial(e.target.value)}
                  onBlur={handleReasonBlur}
                  className={`${inputClass} resize-y`}
                  placeholder="Skip the pitch — what's the actual problem?"
                />
              </Field>

              {followupLoading ? (
                <p className="text-body-sm text-ink-subtle">
                  Thinking about a follow-up question…
                </p>
              ) : null}

              {followupQuestion ? (
                <Field label={followupQuestion} htmlFor="bk-followup">
                  <textarea
                    id="bk-followup"
                    rows={3}
                    value={followupAnswer}
                    onChange={(e) => setFollowupAnswer(e.target.value)}
                    className={`${inputClass} resize-y`}
                    placeholder="A sentence or two is plenty."
                  />
                </Field>
              ) : null}

              {/* Honeypot field — visually + screen-reader hidden */}
              <div aria-hidden="true" className="absolute -left-[9999px]">
                <label>
                  Website (leave blank)
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>

              {turnstileSiteKey ? (
                <div ref={turnstileContainerRef} className="mt-2" />
              ) : null}

              {submitError ? (
                <p
                  role="alert"
                  className="rounded-md border border-semantic-error/40 bg-semantic-error/5 px-3 py-2 text-body-sm text-semantic-error"
                >
                  {submitError}
                </p>
              ) : null}

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Booking…" : "Confirm booking"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSlot(null)}
                  className="text-body-sm text-ink-subtle underline hover:text-ink"
                >
                  Pick a different time
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </form>
    </>
  );
}

// ----------------------------------------------------------------------------
// Helpers + subcomponents
// ----------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-body text-ink placeholder:text-ink-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle"
      >
        {label}
        {optional ? (
          <span className="ml-2 normal-case tracking-normal text-ink-subtle/60">
            optional
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function groupSlotsByDate(
  slots: AvailableSlotWire[],
  timezone: string,
): Record<string, AvailableSlotWire[]> {
  const out: Record<string, AvailableSlotWire[]> = {};
  for (const s of slots) {
    const dateKey = isoDateInTz(s.startUtc, timezone);
    if (!out[dateKey]) out[dateKey] = [];
    out[dateKey].push(s);
  }
  return out;
}

function isoDateInTz(utcIso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(utcIso));
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return utcIso.slice(0, 10);
  }
}

function formatDateLabel(dateKey: string, timezone: string): string {
  try {
    // dateKey is "YYYY-MM-DD" — treat as a date in the tz at noon to
    // avoid DST edge cases when reading back into Intl.
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return dateKey;
  }
}

function formatTimeLabel(utcIso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(utcIso));
  } catch {
    return utcIso.slice(11, 16);
  }
}

function formatSlotLabel(slot: AvailableSlotWire, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(slot.startUtc));
  } catch {
    return slot.startUtc;
  }
}

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
