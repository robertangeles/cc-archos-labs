"use client";

import { useEffect, useState } from "react";
import {
  SITE_DEFAULTS,
  type SiteSettings,
} from "../../../../lib/site-config-shared";

type LoadStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "load-error"; message: string };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

type FieldKey = keyof SiteSettings;

const fieldDefs: Array<{
  key: FieldKey;
  label: string;
  hint?: string;
  type?: "text" | "textarea";
}> = [
  { key: "siteName", label: "Site name", hint: "Used in page titles + Organization schema." },
  { key: "tagline", label: "Tagline", hint: "Short descriptor near the hero, OG cards." },
  {
    key: "description",
    label: "Default meta description",
    hint: "Falls back here when a page doesn't define its own.",
    type: "textarea",
  },
  { key: "founderName", label: "Founder name", hint: "For Person JSON-LD schema." },
  { key: "founderLinkedinUrl", label: "Founder LinkedIn URL" },
  {
    key: "ogImageUrl",
    label: "OG image URL",
    hint: "Path to the social share image (relative or absolute).",
  },
  { key: "twitterHandle", label: "Twitter / X handle", hint: "Without the @ — e.g. archoslabs." },
  { key: "linkedinUrl", label: "LinkedIn page URL", hint: "Used in Organization sameAs." },
];

export default function AdminSitePage() {
  const [settings, setSettings] = useState<SiteSettings>(SITE_DEFAULTS);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/site");
        const json = (await res.json().catch(() => null)) as
          | { ok: boolean; data?: SiteSettings; error?: string }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setSettings({ ...SITE_DEFAULTS, ...json.data });
          setLoad({ kind: "ready" });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load settings.",
          });
        }
      } catch {
        if (!cancelled) {
          setLoad({ kind: "load-error", message: "Network error." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key: FieldKey, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/admin/settings/site", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: SiteSettings; error?: string }
        | null;
      if (res.ok && json?.ok) {
        setSave({ kind: "saved" });
        setTimeout(() => setSave({ kind: "idle" }), 2500);
        return;
      }
      setSave({
        kind: "error",
        message: json?.error ?? "Could not save.",
      });
    } catch {
      setSave({ kind: "error", message: "Network error." });
    }
  }

  return (
    <section>
      <h1 className="text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-[40px]">
        SEO &amp; Brand
      </h1>
      <p className="mt-4 max-w-[600px] text-base leading-[1.7] text-ink-subtle">
        Brand and SEO defaults consumed by every page&rsquo;s metadata,
        the sitemap, robots.txt, the OG card, and JSON-LD schemas.
        Changes save to the database and apply on the next page request.
      </p>

      {load.kind === "loading" ? (
        <p className="mt-12 text-sm text-ink-subtle">Loading settings…</p>
      ) : load.kind === "load-error" ? (
        <p role="alert" className="mt-12 text-sm text-[#f87171]">
          {load.message}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-12 flex flex-col gap-y-6">
          {fieldDefs.map((field) => (
            <label key={String(field.key)} className="flex flex-col gap-y-2">
              <span className={labelClass}>{field.label}</span>
              {field.type === "textarea" ? (
                <textarea
                  name={String(field.key)}
                  required
                  rows={3}
                  value={settings[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={`${inputClass} resize-y`}
                />
              ) : (
                <input
                  type="text"
                  name={String(field.key)}
                  value={settings[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
              {field.hint ? (
                <span className="text-xs leading-[1.5] text-ink-subtle">
                  {field.hint}
                </span>
              ) : null}
            </label>
          ))}

          {save.kind === "error" ? (
            <p role="alert" className="text-sm leading-[1.6] text-[#f87171]">
              {save.message}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
            <p
              className={`text-sm leading-[1.6] transition-colors duration-150 ${
                save.kind === "saved" ? "text-primary" : "text-ink-subtle"
              }`}
            >
              {save.kind === "saved"
                ? "Saved. Live on next page request."
                : "Changes apply on next page request."}
            </p>
            <button
              type="submit"
              disabled={save.kind === "saving"}
              className="inline-flex items-center rounded-md bg-primary px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
            >
              {save.kind === "saving"
                ? "Saving…"
                : save.kind === "saved"
                  ? "Saved"
                  : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
