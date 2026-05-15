"use client";

import { useEffect, useState } from "react";

// Shape that mirrors getIntegrationConfigRedacted() — secrets are
// pre-redacted server-side. Client never holds plaintext secrets
// except in the brief reveal window (transient state, never persisted).
export interface RedactedConfig {
  adminPassword: string;
  resendApiKey: string;
  llmApiKey: string;
  contactRecipientEmail: string;
  resendFromEmail: string;
  llmModelId: string | null;
  // Plaintext on the wire: identifier-grade, browser sees it during OAuth anyway.
  googleOauthClientId: string | null;
  // Always redacted: this is the real credential.
  googleOauthClientSecret: string;
}

export interface AuditRow {
  id: string;
  keyName: string;
  operation: string;
  actor: string;
  createdAt: string;
}

type FieldKey = keyof RedactedConfig;

const ENCRYPTED_FIELDS: ReadonlyArray<FieldKey> = [
  "adminPassword",
  "resendApiKey",
  "llmApiKey",
  "googleOauthClientSecret",
];

// Fields that accept null (empty string in the form clears them).
// Mirrors the .nullable() entries in IntegrationConfigSchema.
const NULLABLE_FIELDS: ReadonlyArray<FieldKey> = [
  "llmModelId",
  "googleOauthClientId",
  "googleOauthClientSecret",
];

function isEncrypted(field: FieldKey): boolean {
  return (ENCRYPTED_FIELDS as ReadonlyArray<string>).includes(field);
}

function isNullable(field: FieldKey): boolean {
  return (NULLABLE_FIELDS as ReadonlyArray<string>).includes(field);
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "result"; ok: boolean; message: string };

type RevealedValue = { value: string; expiresAt: number };

const inputClass =
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";
const labelClass =
  "text-[12px] font-medium uppercase tracking-[0.08em] text-ink-subtle";
const buttonClass =
  "rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

// Which integration's detail page we're rendering. The index lives in a
// separate IntegrationsGrid component; this panel always renders the
// fields for exactly one integration.
export type IntegrationSlug =
  | "email"
  | "ai-model"
  | "authentication"
  | "google-calendar";

// Google-specific extras passed in only when view === 'google-calendar'.
// Coming from the page server component which reads the consultant row.
export interface GoogleConnectInfo {
  status: "pending" | "ok" | "stale" | "not_configured";
  consultantEmail: string | null;
  displayName: string | null;
  banner?:
    | { tone: "success" | "error"; title: string; detail?: string }
    | null;
}

export function IntegrationsPanel({
  view,
  initialConfig,
  googleConnect,
}: {
  view: IntegrationSlug;
  initialConfig: RedactedConfig;
  googleConnect?: GoogleConnectInfo;
}) {
  const [config, setConfig] = useState<RedactedConfig>(initialConfig);

  // Per-field edit state. null = not editing; string = current draft value.
  const [editing, setEditing] = useState<
    Partial<Record<FieldKey, string | null>>
  >({});

  const [saveStatus, setSaveStatus] = useState<
    Partial<Record<FieldKey, SaveStatus>>
  >({});

  // Revealed plaintext (transient — cleared after 30s).
  const [revealed, setRevealed] = useState<
    Partial<Record<FieldKey, RevealedValue>>
  >({});

  // Reveal-auth modal: which field is the user trying to reveal?
  const [revealAuthFor, setRevealAuthFor] = useState<FieldKey | null>(null);
  // Confirm-reveal modal: shows reveal token already exists, just confirm field
  const [revealError, setRevealError] = useState<string | null>(null);

  // Test-connection status per integration.
  const [testResend, setTestResend] = useState<TestStatus>({ kind: "idle" });
  const [testOpenrouter, setTestOpenrouter] = useState<TestStatus>({
    kind: "idle",
  });

  // Rotate-master-key modal state.
  const [showRotate, setShowRotate] = useState(false);

  // Auto-clear revealed values after 30 seconds. Per-field timers.
  useEffect(() => {
    const now = Date.now();
    const earliest = Object.values(revealed).reduce<number | null>((min, v) => {
      if (!v) return min;
      if (min === null) return v.expiresAt;
      return Math.min(min, v.expiresAt);
    }, null);
    if (earliest === null) return;
    const timeout = setTimeout(() => {
      setRevealed((prev) => {
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev) as Array<
          [FieldKey, RevealedValue | undefined]
        >) {
          if (v && v.expiresAt > Date.now()) next[k] = v;
        }
        return next;
      });
    }, Math.max(100, earliest - now));
    return () => clearTimeout(timeout);
  }, [revealed]);

  async function handleSave(field: FieldKey) {
    const value = editing[field];
    if (value === undefined || value === null) return;
    setSaveStatus((s) => ({ ...s, [field]: { kind: "saving" } }));
    try {
      // Nullable fields accept empty string from the form to mean "clear" → null.
      const wireValue = isNullable(field) && value === "" ? null : value;

      const resp = await fetch("/api/admin/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: wireValue }),
      });
      const body = await resp.json();
      if (!resp.ok || !body.ok) {
        setSaveStatus((s) => ({
          ...s,
          [field]: {
            kind: "error",
            message: body.error ?? "Save failed.",
          },
        }));
        return;
      }
      setConfig((c) => ({
        ...c,
        [field]: isEncrypted(field) ? body.redacted : wireValue,
      }));
      setEditing((e) => ({ ...e, [field]: null }));
      setSaveStatus((s) => ({ ...s, [field]: { kind: "saved" } }));
      // Clear "saved" badge after a beat.
      setTimeout(() => {
        setSaveStatus((s) => ({ ...s, [field]: { kind: "idle" } }));
      }, 2000);
      // Audit log lives on the index page now — next navigation
      // will fetch fresh rows. No in-page refresh needed.
    } catch (err) {
      console.error("save failed:", err);
      setSaveStatus((s) => ({
        ...s,
        [field]: { kind: "error", message: "Network error." },
      }));
    }
  }

  async function handleReveal(field: FieldKey, password?: string) {
    setRevealError(null);
    // If we don't have a reveal cookie yet, the server returns 401 and we
    // pop the password prompt. After password succeeds, we retry.
    if (password) {
      const authResp = await fetch(
        "/api/admin/integrations/reveal-auth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!authResp.ok) {
        const body = await authResp.json().catch(() => ({}));
        setRevealError(body.error ?? "Authentication failed.");
        return;
      }
    }

    const resp = await fetch("/api/admin/integrations/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field }),
    });

    if (resp.status === 401) {
      // Need password re-confirm. Open the modal.
      setRevealAuthFor(field);
      return;
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      setRevealError(body.error ?? "Reveal failed.");
      return;
    }
    const body = await resp.json();
    setRevealed((r) => ({
      ...r,
      [field]: { value: body.value, expiresAt: Date.now() + 30_000 },
    }));
    setRevealAuthFor(null);
  }

  function handleHide(field: FieldKey) {
    setRevealed((r) => {
      const next = { ...r };
      delete next[field];
      return next;
    });
  }

  async function handleTest(provider: "resend" | "openrouter") {
    const setter = provider === "resend" ? setTestResend : setTestOpenrouter;
    setter({ kind: "testing" });
    try {
      const resp = await fetch(
        `/api/admin/integrations/test/${provider}`,
        { method: "POST" },
      );
      const body = await resp.json();
      setter({
        kind: "result",
        ok: body.ok === true,
        message:
          body.message ??
          body.error ??
          (body.ok ? "Connection OK." : "Test failed."),
      });
    } catch {
      setter({
        kind: "result",
        ok: false,
        message: "Network error reaching the test endpoint.",
      });
    }
  }

  return (
    <div className="space-y-10">
      {view === "email" && (
        <Section title="Resend (email)">
          <ConfigField
            field="resendApiKey"
            label="API key"
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`resendApiKey`]}
            onEdit={(v) => setEditing((e) => ({ ...e, resendApiKey: v }))}
            onSave={() => handleSave("resendApiKey")}
            onReveal={() => handleReveal("resendApiKey")}
            onHide={() => handleHide("resendApiKey")}
          />
          <ConfigField
            field="resendFromEmail"
            label="From email"
            hint="Sender address. Must be on a domain verified in Resend."
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`resendFromEmail`]}
            onEdit={(v) => setEditing((e) => ({ ...e, resendFromEmail: v }))}
            onSave={() => handleSave("resendFromEmail")}
          />
          <ConfigField
            field="contactRecipientEmail"
            label="Contact recipient"
            hint="Where contact-form submissions + lead notifications land."
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`contactRecipientEmail`]}
            onEdit={(v) =>
              setEditing((e) => ({ ...e, contactRecipientEmail: v }))
            }
            onSave={() => handleSave("contactRecipientEmail")}
          />
          <TestRow
            provider="resend"
            status={testResend}
            onClick={() => handleTest("resend")}
          />
        </Section>
      )}

      {view === "ai-model" && (
        <Section title="AI Model (OpenRouter)">
          <ConfigField
            field="llmApiKey"
            label="API key"
            hint="OpenRouter API key. Field name is provider-agnostic — value is whatever LLM provider is wired."
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`llmApiKey`]}
            onEdit={(v) => setEditing((e) => ({ ...e, llmApiKey: v }))}
            onSave={() => handleSave("llmApiKey")}
            onReveal={() => handleReveal("llmApiKey")}
            onHide={() => handleHide("llmApiKey")}
          />
          <ConfigField
            field="llmModelId"
            label="Model ID"
            hint="OpenRouter model id (e.g. anthropic/claude-sonnet-4-6). Leave empty for the in-code default."
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`llmModelId`]}
            onEdit={(v) => setEditing((e) => ({ ...e, llmModelId: v }))}
            onSave={() => handleSave("llmModelId")}
          />
          <TestRow
            provider="openrouter"
            status={testOpenrouter}
            onClick={() => handleTest("openrouter")}
          />
        </Section>
      )}

      {view === "authentication" && (
        <Section title="Authentication">
          <ConfigField
            field="adminPassword"
            label="Admin password"
            hint="Used for /admin/login. Reveal requires re-typing your current password."
            config={config}
            editing={editing}
            revealed={revealed}
            saveStatus={saveStatus[`adminPassword`]}
            onEdit={(v) => setEditing((e) => ({ ...e, adminPassword: v }))}
            onSave={() => handleSave("adminPassword")}
            onReveal={() => handleReveal("adminPassword")}
            onHide={() => handleHide("adminPassword")}
          />
          <ReadOnlyEnvRow
            label="AUTH_SECRET"
            hint="JWT signing key for admin + lead sessions. Cannot move to DB — middleware runs in Edge runtime, no DB access. Rotate via Render dashboard."
          />
          <div className="border-t border-hairline pt-4">
            <ReadOnlyEnvRow
              label="Master encryption key"
              hint="BOOKING_ENCRYPTION_KEY. Encrypts every secret in this table. Rotating re-encrypts every row."
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowRotate(true)}
                  className={buttonClass}
                >
                  Rotate master key…
                </button>
              }
            />
          </div>
        </Section>
      )}

      {view === "google-calendar" && (
        <>
          {googleConnect?.banner ? (
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                googleConnect.banner.tone === "success"
                  ? "border-semantic-success/40 bg-semantic-success/5 text-semantic-success"
                  : "border-semantic-error/40 bg-semantic-error/5 text-semantic-error"
              }`}
            >
              <p className="font-medium">{googleConnect.banner.title}</p>
              {googleConnect.banner.detail ? (
                <p className="mt-1 text-ink-subtle">
                  {googleConnect.banner.detail}
                </p>
              ) : null}
            </div>
          ) : null}

          <Section title="Connection">
            <GoogleConnectionBlock info={googleConnect} />
          </Section>

          <Section title="OAuth credentials">
            <p className="text-[12px] text-ink-subtle">
              Paste these from the Google Cloud Console Clients tab. Once
              saved, click Connect above to complete the OAuth grant.
            </p>
            <ConfigField
              field="googleOauthClientId"
              label="Client ID"
              hint="Looks like xxx.apps.googleusercontent.com. Identifier-grade, stored plaintext."
              config={config}
              editing={editing}
              revealed={revealed}
              saveStatus={saveStatus[`googleOauthClientId`]}
              onEdit={(v) =>
                setEditing((e) => ({ ...e, googleOauthClientId: v }))
              }
              onSave={() => handleSave("googleOauthClientId")}
            />
            <ConfigField
              field="googleOauthClientSecret"
              label="Client Secret"
              hint="Starts with GOCSPX-. Encrypted at rest like every other secret here."
              config={config}
              editing={editing}
              revealed={revealed}
              saveStatus={saveStatus[`googleOauthClientSecret`]}
              onEdit={(v) =>
                setEditing((e) => ({ ...e, googleOauthClientSecret: v }))
              }
              onSave={() => handleSave("googleOauthClientSecret")}
              onReveal={() => handleReveal("googleOauthClientSecret")}
              onHide={() => handleHide("googleOauthClientSecret")}
            />
            <ReadOnlyEnvRow
              label="GOOGLE_OAUTH_REDIRECT_URI"
              hint="Lives in env because it differs between dev (localhost) and prod. Must match a value in the Google Cloud Console Authorized redirect URIs list exactly."
            />
          </Section>
        </>
      )}

      {revealError && (
        <div className="rounded-md border border-hairline bg-surface-1/40 p-3 text-sm text-ink-subtle">
          {revealError}
        </div>
      )}

      {revealAuthFor && (
        <RevealAuthModal
          field={revealAuthFor}
          onSubmit={(password) => handleReveal(revealAuthFor, password)}
          onCancel={() => {
            setRevealAuthFor(null);
            setRevealError(null);
          }}
          error={revealError}
        />
      )}

      {showRotate && (
        <RotateMasterKeyModal onClose={() => setShowRotate(false)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">
        {title}
      </h2>
      <div className="space-y-5 rounded-md border border-hairline bg-surface-1/30 p-6">
        {children}
      </div>
    </section>
  );
}

function ConfigField({
  field,
  label,
  hint,
  config,
  editing,
  revealed,
  saveStatus,
  onEdit,
  onSave,
  onReveal,
  onHide,
}: {
  field: FieldKey;
  label: string;
  hint?: string;
  config: RedactedConfig;
  editing: Partial<Record<FieldKey, string | null>>;
  revealed: Partial<Record<FieldKey, RevealedValue>>;
  saveStatus?: SaveStatus;
  onEdit: (v: string | null) => void;
  onSave: () => void;
  onReveal?: () => void;
  onHide?: () => void;
}) {
  const isEditing = editing[field] !== undefined && editing[field] !== null;
  const displayValue =
    revealed[field]?.value ??
    (config[field] === null || config[field] === undefined
      ? "(unset)"
      : String(config[field]));
  const isRevealed = !!revealed[field];

  return (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        {label}
        {hint && (
          <span className="ml-2 normal-case tracking-normal text-ink-subtle/70">
            — {hint}
          </span>
        )}
      </label>

      {isEditing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type={isEncrypted(field) ? "password" : "text"}
            className={inputClass}
            value={editing[field] ?? ""}
            onChange={(e) => onEdit(e.target.value)}
            placeholder={
              field === "llmModelId" ? "leave empty for default" : ""
            }
            autoFocus
          />
          <button
            type="button"
            onClick={onSave}
            className={primaryButtonClass}
            disabled={saveStatus?.kind === "saving"}
          >
            {saveStatus?.kind === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => onEdit(null)}
            className={buttonClass}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <code className="font-mono text-sm text-ink break-all">
            {displayValue}
          </code>
          <div className="flex items-center gap-2">
            {onReveal && !isRevealed && (
              <button
                type="button"
                onClick={onReveal}
                className={buttonClass}
              >
                Reveal
              </button>
            )}
            {onHide && isRevealed && (
              <button type="button" onClick={onHide} className={buttonClass}>
                Hide
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit("")}
              className={buttonClass}
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {saveStatus?.kind === "saved" && (
        <p className="text-xs text-primary">Saved.</p>
      )}
      {saveStatus?.kind === "error" && (
        <p className="text-xs text-semantic-error">{saveStatus.message}</p>
      )}
      {isRevealed && (
        <p className="text-[11px] text-ink-subtle/70">
          Visible for 30 seconds. Copy to a password manager now.
        </p>
      )}
    </div>
  );
}

function ReadOnlyEnvRow({
  label,
  hint,
  rightSlot,
}: {
  label: string;
  hint?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        {label}
        {hint && (
          <span className="ml-2 normal-case tracking-normal text-ink-subtle/70">
            — {hint}
          </span>
        )}
      </label>
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-sm text-ink-subtle">
          Managed in Render dashboard →
        </code>
        {rightSlot}
      </div>
    </div>
  );
}

function TestRow({
  provider,
  status,
  onClick,
}: {
  provider: "resend" | "openrouter";
  status: TestStatus;
  onClick: () => void;
}) {
  const providerLabel = provider === "resend" ? "Resend" : "OpenRouter";
  return (
    <div className="border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-subtle">
          Verify the current {providerLabel} API key works without sending an
          email or consuming tokens.
        </p>
        <button
          type="button"
          onClick={onClick}
          className={buttonClass}
          disabled={status.kind === "testing"}
        >
          {status.kind === "testing" ? "Testing…" : `Test ${providerLabel}`}
        </button>
      </div>
      {status.kind === "result" && (
        <p
          className={`mt-2 text-xs ${status.ok ? "text-primary" : "text-semantic-error"}`}
        >
          {status.ok ? "✓" : "✗"} {status.message}
        </p>
      )}
    </div>
  );
}

function RevealAuthModal({
  field,
  onSubmit,
  onCancel,
  error,
}: {
  field: FieldKey;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const [password, setPassword] = useState("");
  const fieldLabel: Record<FieldKey, string> = {
    adminPassword: "admin password",
    resendApiKey: "Resend API key",
    llmApiKey: "LLM API key",
    contactRecipientEmail: "",
    resendFromEmail: "",
    llmModelId: "",
    googleOauthClientId: "",
    googleOauthClientSecret: "Google OAuth Client Secret",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-surface-2 p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-ink">
          Confirm your password
        </h3>
        <p className="mt-2 text-sm text-ink-subtle">
          Re-enter your admin password to reveal the {fieldLabel[field]}.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) onSubmit(password);
          }}
          className="mt-4 space-y-4"
        >
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="Admin password"
          />
          {error && <p className="text-xs text-semantic-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className={buttonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={primaryButtonClass}
              disabled={!password}
            >
              Reveal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RotateMasterKeyModal({ onClose }: { onClose: () => void }) {
  type RotateState =
    | { kind: "intro" }
    | { kind: "rotating" }
    | { kind: "done"; newKey: string; fieldsRotated: number; instructions: string[] }
    | { kind: "error"; message: string };
  const [state, setState] = useState<RotateState>({ kind: "intro" });

  async function handleRotate() {
    setState({ kind: "rotating" });
    try {
      const resp = await fetch(
        "/api/admin/integrations/rotate-master-key",
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const body = await resp.json();
      if (!resp.ok || !body.ok) {
        setState({
          kind: "error",
          message: body.error ?? "Rotation failed.",
        });
        return;
      }
      setState({
        kind: "done",
        newKey: body.newKey,
        fieldsRotated: body.fieldsRotated,
        instructions: body.instructions,
      });
    } catch {
      setState({
        kind: "error",
        message: "Network error during rotation.",
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-lg border border-hairline bg-surface-2 p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-ink">
          Rotate master encryption key
        </h3>

        {state.kind === "intro" && (
          <>
            <div className="mt-3 space-y-3 text-sm text-ink-subtle">
              <p>
                This generates a fresh 32-byte master key, re-encrypts every
                secret in the integration_secrets row with it, and writes the
                update inside a single transaction.
              </p>
              <p>
                <strong className="font-medium text-ink">
                  Do NOT close this modal between rotation and the Render
                  dashboard update.
                </strong>{" "}
                The new key only takes effect after you update the env var
                AND restart the service.
              </p>
              <p className="text-xs">
                Recovery if interrupted: run{" "}
                <code className="rounded bg-canvas px-1 py-0.5">
                  pnpm rotate-master-key --old &lt;new&gt; --new &lt;old&gt;
                </code>{" "}
                from a shell to swap keys back.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonClass}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRotate}
                className={primaryButtonClass}
              >
                Rotate now
              </button>
            </div>
          </>
        )}

        {state.kind === "rotating" && (
          <p className="mt-4 text-sm text-ink-subtle">Re-encrypting fields…</p>
        )}

        {state.kind === "done" && (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-primary">
              ✓ Rotated {state.fieldsRotated} encrypted field(s).
            </p>
            <div>
              <p className={labelClass}>New master key (copy now)</p>
              <code className="mt-1 block break-all rounded-md bg-canvas px-3 py-2 font-mono text-xs text-ink">
                {state.newKey}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(state.newKey)}
                className={`${buttonClass} mt-2`}
              >
                Copy to clipboard
              </button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-subtle">
              {state.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className={primaryButtonClass}
              >
                I copied it — close
              </button>
            </div>
          </div>
        )}

        {state.kind === "error" && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-semantic-error">{state.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonClass}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditLog({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return (
      <Section title="Recent changes">
        <p className="text-sm text-ink-subtle">
          No changes yet. Edits to integrations will appear here.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Recent changes">
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
            <span
              className="font-mono text-xs text-ink-subtle"
              suppressHydrationWarning
            >
              {new Date(r.createdAt).toLocaleString()}
            </span>
            <span className="text-ink">{r.actor}</span>
            <span className="text-ink-subtle">{r.operation}</span>
            <code className="font-mono text-xs text-ink">{r.keyName}</code>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ----------------------------------------------------------------------------
// Google Calendar connection block — embedded in the google-calendar view
// ----------------------------------------------------------------------------

function GoogleConnectionBlock({
  info,
}: {
  info?: GoogleConnectInfo;
}) {
  const [busy, setBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const status = info?.status ?? "not_configured";
  const consultantEmail = info?.consultantEmail ?? null;
  const displayName = info?.displayName ?? null;

  const handleDisconnect = async () => {
    if (busy) return;
    if (
      !window.confirm(
        "Disconnect Google Calendar? Booking will be disabled until you reconnect.",
      )
    ) {
      return;
    }
    setBusy(true);
    setDisconnectError(null);
    try {
      const res = await fetch("/api/admin/google-oauth/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Disconnect failed (${res.status}).`);
      }
      window.location.reload();
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : "Disconnect failed.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-y-4">
      <div>
        <p className={labelClass}>Status</p>
        <p className="mt-1">
          <ConnectionStatusBadge status={status} />
        </p>
      </div>

      <div className="grid gap-y-2 text-sm text-ink-subtle">
        <Row label="Consultant email" value={consultantEmail ?? "—"} />
        <Row label="Display name" value={displayName ?? "—"} />
        <Row
          label="Working hours"
          value="Mon–Fri 9:00–17:00 (default; profile UI lands later)"
        />
      </div>

      {status === "ok" || status === "stale" ? (
        <div className="flex flex-wrap gap-2 pt-2">
          <a href="/api/admin/google-oauth/start" className={buttonClass}>
            Reconnect
          </a>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy}
            className="rounded-md border border-semantic-error/40 px-3 py-1.5 text-xs font-medium text-semantic-error transition-colors hover:bg-semantic-error/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href="/api/admin/google-oauth/start"
            className={primaryButtonClass}
          >
            Connect Google Calendar
          </a>
        </div>
      )}

      {disconnectError ? (
        <p className="text-sm text-semantic-error">{disconnectError}</p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-x-4">
      <span className="text-ink-subtle">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function ConnectionStatusBadge({
  status,
}: {
  status: "pending" | "ok" | "stale" | "not_configured";
}) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-x-2 text-ink">
        <span className="inline-block h-2 w-2 rounded-full bg-semantic-success" />
        Connected
      </span>
    );
  }
  if (status === "stale") {
    return (
      <span className="inline-flex items-center gap-x-2 text-semantic-warning">
        <span className="inline-block h-2 w-2 rounded-full bg-semantic-warning" />
        Stale — refresh token rejected by Google. Reconnect to restore.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-x-2 text-ink-subtle">
      <span className="inline-block h-2 w-2 rounded-full bg-ink-subtle/50" />
      Not connected
    </span>
  );
}
