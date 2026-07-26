"use client";

import { useEffect, useState } from "react";
import {
  BLOG_AGENT_CONFIG_STARTER,
  type BlogAgentConfig,
} from "../../../../../lib/blog-agent/config-shared";

// Settings for the blog agent, and the home of its kill switch.
//
// The kill switch is deliberately not a checkbox inside the settings form.
// It saves the moment you toggle it, in its own block, above everything else.
// The one time you reach for it, hunting for a Save button at the bottom of a
// long form is the wrong experience — and until this page existed the only way
// to stop the agent was a hand-written UPDATE against site_setting.
//
// Ids derived by scripts/seed-blog-agent-config.mjs are shown read-only.
// Hand-editing a workflow field id is precisely how the mapping breaks, and
// the preflight exists because it broke that way before.

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

const hintClass = "text-xs leading-[1.5] text-ink-subtle";

const readOnlyClass =
  "w-full rounded-md border border-hairline bg-surface-1/40 px-4 py-3 font-mono text-[12px] text-ink-subtle";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-y-2">
      <span className={labelClass}>{label}</span>
      {children}
      <span className={hintClass}>{hint}</span>
    </label>
  );
}

export function BlogAgentConfigEditor() {
  const [config, setConfig] = useState<BlogAgentConfig>(BLOG_AGENT_CONFIG_STARTER);
  const [load, setLoad] = useState<LoadStatus>({ kind: "loading" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [togglingSwitch, setTogglingSwitch] = useState(false);
  // Free-text mirrors, so a half-typed "2,3," does not get parsed into
  // nonsense on every keystroke.
  const [rampText, setRampText] = useState("");
  const [allowlistText, setAllowlistText] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings/blog-agent");
        const json = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: BlogAgentConfig;
              error?: string;
              invalidFields?: string[];
            }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.data) {
          setConfig(json.data);
          setRampText(json.data.velocity.weeklyRamp.join(", "));
          setAllowlistText(json.data.linkAllowlist.join("\n"));
          setInvalidFields(json.invalidFields ?? []);
          setLoad({ kind: "ready" });
        } else {
          setLoad({
            kind: "load-error",
            message: json?.error ?? "Could not load the settings.",
          });
        }
      } catch {
        if (!cancelled) setLoad({ kind: "load-error", message: "Network error." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: BlogAgentConfig): Promise<boolean> {
    const res = await fetch("/api/admin/settings/blog-agent", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; error?: string }
      | null;
    if (res.ok && json?.ok) return true;
    setSave({ kind: "error", message: json?.error ?? "Could not save." });
    return false;
  }

  /** The kill switch writes immediately. No Save button in the way. */
  async function toggleEnabled() {
    if (togglingSwitch) return;
    setTogglingSwitch(true);
    const next = { ...config, enabled: !config.enabled };
    setConfig(next); // optimistic — the operator sees it stop at once
    try {
      const ok = await persist(next);
      if (!ok) setConfig(config); // roll back to what is actually stored
      else setInvalidFields([]);
    } catch {
      setConfig(config);
      setSave({ kind: "error", message: "Network error. The agent may still be running." });
    } finally {
      setTogglingSwitch(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.kind === "saving") return;
    setSave({ kind: "saving" });

    const ramp = rampText
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 7);
    if (ramp.length === 0) {
      setSave({ kind: "error", message: "Cadence needs at least one number from 0 to 7." });
      return;
    }

    const next: BlogAgentConfig = {
      ...config,
      velocity: { ...config.velocity, weeklyRamp: ramp },
      linkAllowlist: allowlistText
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean),
    };

    try {
      if (await persist(next)) {
        setConfig(next);
        setRampText(ramp.join(", "));
        setInvalidFields([]);
        setSave({ kind: "saved" });
        setTimeout(() => setSave({ kind: "idle" }), 2500);
      }
    } catch {
      setSave({ kind: "error", message: "Network error." });
    }
  }

  if (load.kind === "loading") {
    return <p className="text-body-sm text-ink-subtle">Loading…</p>;
  }
  if (load.kind === "load-error") {
    return (
      <p role="alert" className="text-body-sm text-semantic-error">
        {load.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-y-8">
      {/* Kill switch. Separated, first, and saves on toggle. */}
      <section
        className={`rounded-md border px-5 py-5 sm:px-6 ${
          config.enabled
            ? "border-semantic-error/40 bg-semantic-error/5"
            : "border-hairline bg-surface-1/30"
        }`}
      >
        <div className="flex flex-col gap-y-4 sm:flex-row sm:items-center sm:justify-between sm:gap-x-6">
          <div>
            <p
              className={`text-eyebrow uppercase ${
                config.enabled ? "text-semantic-error" : "text-ink-subtle"
              }`}
            >
              {config.enabled ? "Agent is running" : "Agent is stopped"}
            </p>
            <p className="mt-2 max-w-xl text-body-sm leading-[1.6] text-ink/90">
              {config.enabled
                ? "It researches, writes and queues a post on its schedule. Nothing it writes reaches the public site until you clear the review flag on that post."
                : "It will not run, spend anything, or queue anything. Posts already scheduled and approved still publish on their own timer."}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={togglingSwitch}
            aria-pressed={config.enabled}
            className={`inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md px-7 py-3 text-button transition-colors duration-150 disabled:opacity-60 ${
              config.enabled
                ? "bg-semantic-error text-inverse-ink hover:bg-semantic-error/85"
                : "bg-primary text-on-primary hover:bg-primary-hover"
            }`}
          >
            {togglingSwitch
              ? "Saving…"
              : config.enabled
                ? "Stop the agent"
                : "Start the agent"}
          </button>
        </div>
        <p className="mt-4 text-xs text-ink-subtle">
          Saves the moment you press it. Takes effect on the next run.
        </p>
      </section>

      {invalidFields.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-semantic-warning/40 bg-semantic-warning/5 px-5 py-4"
        >
          <p className="text-eyebrow uppercase text-semantic-warning">
            Settings are not valid, so the agent is not running
          </p>
          <p className="mt-2 text-body-sm leading-[1.6] text-ink/90">
            These fields failed validation:{" "}
            <span className="font-mono text-[13px]">
              {invalidFields.join(", ")}
            </span>
            . The agent has fallen back to a disabled default. Saving this form
            repairs it, or re-run{" "}
            <span className="font-mono text-[13px]">
              scripts/seed-blog-agent-config.mjs
            </span>{" "}
            to rebuild every id from the database.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
        <Field
          label="Cadence — posts per week"
          hint="One number per week since the start date; the last one holds from then on. Ramps rather than jumping, because publishing velocity measured against a site's own history is a scaled-content signal, and this blog has 254 posts and almost no recent publishing."
        >
          <input
            type="text"
            inputMode="numeric"
            value={rampText}
            onChange={(e) => setRampText(e.target.value)}
            placeholder="2, 3, 5, 7"
            className={inputClass}
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Publish hour"
            hint="Posts are scheduled for the next occurrence of this hour."
          >
            <input
              type="number"
              min={0}
              max={23}
              value={config.publishAt.hour}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  publishAt: { ...c.publishAt, hour: Number(e.target.value) },
                }))
              }
              className={inputClass}
            />
          </Field>

          <Field
            label="Time zone"
            hint="Australia/Sydney gives 7am local year-round, shifting with daylight saving. Australia/Brisbane gives a fixed UTC+10."
          >
            <input
              type="text"
              value={config.publishAt.timeZone}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  publishAt: { ...c.publishAt, timeZone: e.target.value },
                }))
              }
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Reviewer model"
            hint="Deliberately a different model family from the writer, so it is not marking its own homework."
          >
            <input
              type="text"
              value={config.judgeModel}
              onChange={(e) =>
                setConfig((c) => ({ ...c, judgeModel: e.target.value }))
              }
              className={inputClass}
            />
          </Field>

          <Field
            label="Refill the queue below"
            hint="When fewer than this many topics are waiting, a new batch is researched. Zero disables automatic refills."
          >
            <input
              type="number"
              min={0}
              value={config.minQueueDepth}
              onChange={(e) =>
                setConfig((c) => ({ ...c, minQueueDepth: Number(e.target.value) }))
              }
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Minimum grounding"
            hint="Share of paragraphs that must carry a figure traceable to the research. Below this, the draft is rejected. 0.5 means half."
          >
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={config.minGroundingRatio}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  minGroundingRatio: Number(e.target.value),
                }))
              }
              className={inputClass}
            />
          </Field>

          <Field
            label="Duplicate threshold"
            hint="How close a new topic may be to an existing post before it is skipped. Lower is stricter."
          >
            <input
              type="number"
              step="0.05"
              min={0}
              max={2}
              value={config.duplicateThreshold}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  duplicateThreshold: Number(e.target.value),
                }))
              }
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Link allowlist"
          hint="One domain per line. An external link to anywhere else is stripped from the draft and recorded. This is the control that removes the payoff from anything the research was steered into recommending."
        >
          <textarea
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            rows={7}
            className={`${inputClass} resize-y font-mono text-[13px] leading-[1.55]`}
          />
        </Field>

        <Field
          label="Alert email"
          hint="Where failures go. Leave empty to turn alerting off."
        >
          <input
            type="email"
            value={config.alertEmail}
            onChange={(e) =>
              setConfig((c) => ({ ...c, alertEmail: e.target.value }))
            }
            placeholder="you@example.com"
            className={inputClass}
          />
        </Field>

        <label className="flex items-start gap-x-3">
          <input
            type="checkbox"
            checked={config.image.enabled}
            onChange={(e) =>
              setConfig((c) => ({ ...c, image: { enabled: e.target.checked } }))
            }
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            <span className="block text-body-sm text-ink">
              Generate an illustration for each post
            </span>
            <span className={`mt-1 block ${hintClass}`}>
              Off, posts still get the house fallback image. Turn this off if
              illustrations start coming back wrong and you want posts to keep
              landing while it is investigated.
            </span>
          </span>
        </label>

        {save.kind === "error" ? (
          <p role="alert" className="text-body-sm text-semantic-error">
            {save.message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-x-4 border-t border-hairline pt-6">
          <p
            className={`text-body-sm transition-colors duration-150 ${
              save.kind === "saved" ? "text-semantic-success" : "text-ink-subtle"
            }`}
          >
            {save.kind === "saved"
              ? "Saved. Applies on the next run."
              : "Applies on the next run."}
          </p>
          <button
            type="submit"
            disabled={save.kind === "saving"}
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-7 py-3 text-button text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
          >
            {save.kind === "saving"
              ? "Saving…"
              : save.kind === "saved"
                ? "Saved"
                : "Save settings"}
          </button>
        </div>
      </form>

      {/* Derived ids. Read-only on purpose. */}
      <section className="border-t border-hairline pt-8">
        <h2 className="text-card-title text-ink">Wiring</h2>
        <p className={`mt-2 max-w-2xl ${hintClass}`}>
          Derived from the database by{" "}
          <span className="font-mono text-[12px]">
            scripts/seed-blog-agent-config.mjs
          </span>
          . Read-only here because hand-editing a workflow field id is exactly
          how the mapping breaks: the agent would pass inputs keyed to an id no
          field has, and write a confident article about nothing. Re-run the
          script after any change to the workflow&rsquo;s input fields.
        </p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            ["Workflow", config.workflowId],
            ["Runs as", config.runAsUserId],
            ["Byline", config.authorId],
            ["Topic field", config.fieldMap.topic],
            ["Audience field", config.fieldMap.audience],
            ["Action field", config.fieldMap.action],
            ["Word count field", config.fieldMap.wordCount],
            [
              "Illustration setting field",
              config.fieldMap.imagePlace ?? "not set — every post shares one setting",
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-y-2">
              <dt className={labelClass}>{label}</dt>
              <dd>
                <p className={readOnlyClass}>{value}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
