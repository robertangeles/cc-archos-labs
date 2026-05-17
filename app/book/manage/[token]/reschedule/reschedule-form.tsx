"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarPicker,
  NextAvailableChip,
  formatSlotLabel,
  groupSlotsByDate,
  type AvailableSlotWire,
} from "../../../../../components/booking/calendar-picker";

// Reschedule slot picker. Loads availability for the consultant the
// same way the booking page does, lets the prospect pick a new slot,
// and POSTs to /api/booking/reschedule. No intake fields — name /
// email / reason carry over from the old booking row.

interface RescheduleFormProps {
  token: string;
  consultant: {
    slug: string;
    displayName: string;
    slotMinutes: number;
    timezone: string;
  };
  currentSlotStart: string;
  prospectTimezone: string;
}

export function RescheduleForm({
  token,
  consultant,
  currentSlotStart,
  prospectTimezone,
}: RescheduleFormProps) {
  const [slots, setSlots] = useState<AvailableSlotWire[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlotWire | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [freebusyOk, setFreebusyOk] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const slotsByDate = useMemo(
    () => groupSlotsByDate(slots, prospectTimezone),
    [slots, prospectTimezone],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(
          `/api/booking/${consultant.slug}/availability`,
        );
        if (!resp.ok) {
          throw new Error(`Could not load availability (${resp.status}).`);
        }
        const body = await resp.json();
        if (cancelled) return;
        const fetched = (body.slots ?? []) as AvailableSlotWire[];
        // Hide the slot the user is currently booked into — they can't
        // reschedule to the same time, and it would 409 anyway.
        const filtered = fetched.filter((s) => s.startUtc !== currentSlotStart);
        setSlots(filtered);
        setFreebusyOk(body.freebusyOk !== false);
        const grouped = groupSlotsByDate(filtered, prospectTimezone);
        const firstDate = Object.keys(grouped)[0];
        if (firstDate) setSelectedDate(firstDate);
      } catch (err) {
        if (!cancelled) {
          setSlotsError(
            err instanceof Error ? err.message : "Failed to load.",
          );
        }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [consultant.slug, currentSlotStart, prospectTimezone]);

  const dateKeys = Object.keys(slotsByDate);

  async function handleConfirm() {
    if (!selectedSlot) {
      setSubmitError("Pick a new time first.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await fetch("/api/booking/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          slotStartUtc: selectedSlot.startUtc,
          slotEndUtc: selectedSlot.endUtc,
          prospectTimezone,
        }),
      });
      const body = await resp.json();
      if (resp.ok && body.ok) {
        window.location.href = `/book/${body.slug ?? consultant.slug}/confirmation/${body.bookingId}`;
        return;
      }
      if (resp.status === 409 && body.slots) {
        setSlots(
          (body.slots as AvailableSlotWire[]).filter(
            (s) => s.startUtc !== currentSlotStart,
          ),
        );
        setSelectedSlot(null);
        setSubmitError("That slot was just taken. Pick another.");
      } else {
        setSubmitError(body.error ?? "Could not reschedule.");
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Network error.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-md border border-hairline bg-surface-1 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-card-title text-ink">Pick a new time</h2>
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
          Calendar sync delayed — some times may already be taken.
        </p>
      ) : null}

      {slotsLoading ? (
        <p className="mt-6 text-body-sm text-ink-subtle">
          Loading available times…
        </p>
      ) : slotsError ? (
        <p className="mt-6 text-body-sm text-semantic-error">{slotsError}</p>
      ) : dateKeys.length === 0 ? (
        <p className="mt-6 text-body-sm text-ink-subtle">
          No other times available. Cancel and rebook from the home page when
          new slots open up.
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

      {selectedSlot ? (
        <div className="mt-6 flex flex-col gap-4 border-t border-hairline pt-6">
          <p className="text-body-sm text-ink-subtle">
            Move your call to{" "}
            <span className="text-ink">
              {formatSlotLabel(selectedSlot, prospectTimezone)}
            </span>
            ?
          </p>
          {submitError ? (
            <p
              role="alert"
              className="rounded-md border border-semantic-error/40 bg-semantic-error/5 px-3 py-2 text-body-sm text-semantic-error"
            >
              {submitError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Rescheduling…" : "Confirm reschedule"}
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
      ) : null}
    </section>
  );
}
