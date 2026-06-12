"use client";

import { useEffect, useState } from "react";

interface ConsultantProfile {
  id: string;
  slug: string;
  displayName: string;
  email: string;
  publicEmail: string | null;
  timezone: string;
  slotMinutes: number;
  slotBufferMinutes: number;
  advanceDays: number;
  minNoticeHours: number;
  workingHoursJson: Record<string, [number, number]>;
}

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function ConsultantProfileForm() {
  const [profile, setProfile] = useState<ConsultantProfile | null>(null);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/consultant/profile");
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setProfile(json.data);
          setLoad({ kind: "ready" });
        } else if (res.status === 404) {
          setLoad({ kind: "not-found" });
        } else {
          setLoad({ kind: "error", message: json?.error ?? "Load failed." });
        }
      } catch {
        if (!cancelled) setLoad({ kind: "error", message: "Network error." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function update<K extends keyof ConsultantProfile>(
    key: K,
    value: ConsultantProfile[K],
  ) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function updateWorkingHour(day: string, idx: 0 | 1, value: number) {
    setProfile((p) => {
      if (!p) return p;
      const wh = { ...p.workingHoursJson };
      const pair = wh[day] ? ([...wh[day]] as [number, number]) : [9, 17] as [number, number];
      pair[idx] = value;
      wh[day] = pair;
      return { ...p, workingHoursJson: wh };
    });
  }

  function toggleDay(day: string, enabled: boolean) {
    setProfile((p) => {
      if (!p) return p;
      const wh = { ...p.workingHoursJson };
      if (enabled) {
        wh[day] = [9, 17];
      } else {
        delete wh[day];
      }
      return { ...p, workingHoursJson: wh };
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile || save.kind === "saving") return;
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/admin/consultant/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: profile.displayName,
          slug: profile.slug,
          timezone: profile.timezone,
          publicEmail: profile.publicEmail || null,
          slotMinutes: profile.slotMinutes,
          slotBufferMinutes: profile.slotBufferMinutes,
          advanceDays: profile.advanceDays,
          minNoticeHours: profile.minNoticeHours,
          workingHoursJson: profile.workingHoursJson,
        }),
      });
      const json = await res.json();
      if (res.ok && json?.ok) {
        if (json.data) setProfile(json.data);
        setSave({ kind: "saved" });
        setTimeout(() => setSave({ kind: "idle" }), 2500);
      } else {
        setSave({ kind: "error", message: json?.error ?? "Save failed." });
      }
    } catch {
      setSave({ kind: "error", message: "Network error." });
    }
  }

  if (load.kind === "loading") {
    return <p className="text-body-sm text-ink-subtle">Loading consultant profile…</p>;
  }
  if (load.kind === "not-found") {
    return (
      <p className="text-body-sm text-ink-subtle">
        No consultant record found. Connect Google Calendar first.
      </p>
    );
  }
  if (load.kind === "error") {
    return <p className="text-body-sm text-semantic-error">{load.message}</p>;
  }
  if (!profile) return null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Display name</span>
          <input
            type="text"
            value={profile.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Booking slug</span>
          <input
            type="text"
            value={profile.slug}
            onChange={(e) => update("slug", e.target.value)}
            className={inputClass}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
          />
          <span className="text-[10px] text-ink-subtle/70">
            /book/{profile.slug}
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Timezone (IANA)</span>
          <input
            type="text"
            value={profile.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            placeholder="Australia/Sydney"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Public email (optional)</span>
          <input
            type="email"
            value={profile.publicEmail ?? ""}
            onChange={(e) => update("publicEmail", e.target.value || null)}
            placeholder="Falls back to internal email"
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Slot (min)</span>
          <input
            type="number"
            value={profile.slotMinutes}
            onChange={(e) => update("slotMinutes", Number(e.target.value))}
            min={10}
            max={180}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Buffer (min)</span>
          <input
            type="number"
            value={profile.slotBufferMinutes}
            onChange={(e) => update("slotBufferMinutes", Number(e.target.value))}
            min={0}
            max={120}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Advance (days)</span>
          <input
            type="number"
            value={profile.advanceDays}
            onChange={(e) => update("advanceDays", Number(e.target.value))}
            min={1}
            max={90}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-y-1">
          <span className={labelClass}>Min notice (hrs)</span>
          <input
            type="number"
            value={profile.minNoticeHours}
            onChange={(e) => update("minNoticeHours", Number(e.target.value))}
            min={0}
            max={168}
            className={inputClass}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-y-3">
        <legend className={labelClass}>Working hours</legend>
        <div className="flex flex-col gap-y-2">
          {DAYS.map((day) => {
            const enabled = day in profile.workingHoursJson;
            const hours = profile.workingHoursJson[day] ?? [9, 17];
            return (
              <div key={day} className="flex items-center gap-x-3">
                <label className="flex w-24 items-center gap-x-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleDay(day, e.target.checked)}
                    className="rounded border-hairline"
                  />
                  {DAY_LABELS[day]}
                </label>
                {enabled && (
                  <div className="flex items-center gap-x-1 text-sm text-ink-subtle">
                    <input
                      type="number"
                      value={hours[0]}
                      onChange={(e) => updateWorkingHour(day, 0, Number(e.target.value))}
                      min={0}
                      max={23}
                      className="w-14 rounded-md border border-hairline bg-canvas px-2 py-1 text-center text-sm"
                    />
                    <span>to</span>
                    <input
                      type="number"
                      value={hours[1]}
                      onChange={(e) => updateWorkingHour(day, 1, Number(e.target.value))}
                      min={1}
                      max={24}
                      className="w-14 rounded-md border border-hairline bg-canvas px-2 py-1 text-center text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {save.kind === "error" && (
        <p role="alert" className="text-body-sm text-semantic-error">
          {save.message}
        </p>
      )}

      <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
        <p
          className={`text-body-sm transition-colors duration-150 ${
            save.kind === "saved"
              ? "text-semantic-success"
              : "text-ink-subtle"
          }`}
        >
          {save.kind === "saved"
            ? "Saved. Live on next booking page load."
            : "Changes apply on next booking page load."}
        </p>
        <button
          type="submit"
          disabled={save.kind === "saving"}
          className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
        >
          {save.kind === "saving"
            ? "Saving…"
            : save.kind === "saved"
              ? "Saved"
              : "Save profile"}
        </button>
      </div>
    </form>
  );
}
