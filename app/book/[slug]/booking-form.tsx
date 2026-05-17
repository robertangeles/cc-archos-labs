"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPicker,
  NextAvailableChip,
  formatSlotLabel,
  groupSlotsByDate,
  type AvailableSlotWire,
} from "../../../components/booking/calendar-picker";

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

interface BookingFormProps {
  slug: string;
  consultant: {
    displayName: string;
    // Rendered in the escape-hatch line below the form submit. Public-
    // facing email — already exposed via the contact page and the
    // booking confirmation email's reply-to.
    email: string;
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

  // Turnstile widget id (returned by turnstile.render) so we can reset
  // it after a failed submit. Token capture goes through the widget's
  // `callback` option directly into React state — more reliable than
  // polling getResponse() on submit (which can return empty if the
  // widget hasn't completed verification yet).
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>("");

  // Submit state ----------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Render Turnstile when the script is loaded AND the container is
  // mounted (which only happens after the user picks a slot). The
  // selectedSlot dep is load-bearing: without it the effect fires once
  // before the form renders, sees a null container, and never re-runs.
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileReady) return;
    if (!selectedSlot) return; // form not visible yet
    if (!turnstileContainerRef.current) return;
    if (turnstileWidgetIdRef.current) return; // already rendered
    if (!window.turnstile) return;
    const id = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      theme: "dark",
      callback: (token: string) => setTurnstileToken(token),
    });
    turnstileWidgetIdRef.current = id;
  }, [turnstileSiteKey, turnstileReady, selectedSlot]);

  // Reset the widget tracking + token state. Called from the "Pick a
  // different time" button and the slot-conflict refresh path — we
  // can't do this in a useEffect because setState-in-effect is a
  // perf antipattern (React docs: you-might-not-need-an-effect).
  const resetTurnstile = () => {
    turnstileWidgetIdRef.current = null;
    setTurnstileToken("");
  };

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

    // Token comes from the widget's callback (set on every successful
    // verification). When Turnstile isn't configured, turnstileSiteKey
    // is null and we send an empty token — the server checks
    // isTurnstileConfigured() (now requires both keys) and skips
    // verification.
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
          setTurnstileToken(""); // clear stale token until callback fires again
        }
      } else {
        setSubmitError(body.error ?? "Could not book. Try again.");
        if (window.turnstile && turnstileWidgetIdRef.current) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
          setTurnstileToken(""); // clear stale token until callback fires again
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
        // Prevent accidental Enter-submit anywhere except inside a
        // textarea. Users tab out of fields or hit Enter to skip to the
        // next one — the browser default of "submit form on Enter in
        // any input" is treacherous for a multi-step form like this.
        // Textareas keep Enter as newline (their native behaviour).
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            e.target instanceof HTMLElement &&
            e.target.tagName !== "TEXTAREA" &&
            !(e.target instanceof HTMLButtonElement)
          ) {
            e.preventDefault();
          }
        }}
        className="grid gap-8"
        noValidate
        aria-label="Book a call"
      >
        {/* Slot picker */}
        <section className="rounded-md border border-hairline bg-surface-1 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-card-title text-ink">Pick a time</h2>
              <p className="mt-1 text-body-sm text-ink-subtle">
                Times shown in{" "}
                <span className="text-ink">{prospectTimezone}</span>.
                {consultant.timezone !== prospectTimezone ? (
                  <> Consultant is in {consultant.timezone}.</>
                ) : null}
              </p>
            </div>
            {dateKeys[0] && slotsByDate[dateKeys[0]]?.[0] ? (
              <NextAvailableChip
                slot={slotsByDate[dateKeys[0]][0]}
                prospectTimezone={prospectTimezone}
                onPick={(slot, dateKey) => {
                  setSelectedDate(dateKey);
                  setSelectedSlot(slot);
                }}
                dateKey={dateKeys[0]}
              />
            ) : null}
          </div>

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
            <CalendarPicker
              slotsByDate={slotsByDate}
              dateKeys={dateKeys}
              selectedDate={selectedDate}
              onSelectDate={(d) => {
                setSelectedDate(d);
                setSelectedSlot(null);
              }}
              selectedSlot={selectedSlot}
              onSelectSlot={setSelectedSlot}
              prospectTimezone={prospectTimezone}
            />
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
                  disabled={submitting || followupLoading}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? "Booking…"
                    : followupLoading
                      ? "Hold on…"
                      : "Confirm booking"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlot(null);
                    resetTurnstile();
                  }}
                  className="text-body-sm text-ink-subtle underline hover:text-ink"
                >
                  Pick a different time
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {/* Escape hatch — reassures the visitor they can opt out of the
            self-serve flow without disappearing into a void. */}
        <p className="text-center text-body-sm text-ink-subtle">
          Times don&apos;t suit? Email{" "}
          <a
            href={`mailto:${consultant.email}`}
            className="text-ink underline-offset-2 hover:underline"
          >
            {consultant.email}
          </a>{" "}
          directly.
        </p>
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


function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
