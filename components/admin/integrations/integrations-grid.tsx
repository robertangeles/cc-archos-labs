import Link from "next/link";
import type { RedactedConfig } from "./integrations-panel";

// Cards-grid index for /admin/integrations. Each card surfaces the
// integration's status at a glance, then drills down to its detail page.
// Pattern lifted from Stripe Dashboard / Vercel integrations — scales
// past the ~5-section threshold where the old single-page accordion
// fell apart.

type Status =
  | { tone: "success"; label: string }
  | { tone: "warning"; label: string }
  | { tone: "neutral"; label: string }
  | { tone: "error"; label: string };

interface IntegrationCard {
  slug: string;
  title: string;
  description: string;
  status: Status;
}

export interface IntegrationsGridProps {
  config: RedactedConfig;
  // Google's status comes from the consultant row, not integration_secrets.
  googleStatus: "pending" | "ok" | "stale" | "not_configured";
}

export function IntegrationsGrid({
  config,
  googleStatus,
}: IntegrationsGridProps) {
  const cards: IntegrationCard[] = [
    {
      slug: "email",
      title: "Email (Resend)",
      description:
        "Transactional + contact-form delivery. Sends magic-link sign-in and lead notifications.",
      status: redactedSecretToStatus(config.resendApiKey),
    },
    {
      slug: "ai-model",
      title: "AI Model (OpenRouter)",
      description:
        "LLM provider for the AI Readiness narrative + conversational booking intake.",
      status: redactedSecretToStatus(config.llmApiKey),
    },
    {
      slug: "authentication",
      title: "Authentication",
      description:
        "Admin password, JWT signing key, master encryption key for every secret here.",
      status: { tone: "success", label: "Active" },
    },
    {
      slug: "google-calendar",
      title: "Google Calendar",
      description:
        "Read availability + create events with Meet links for the Book-a-Call flow.",
      status: googleStatusToStatus(googleStatus),
    },
  ];

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <li key={card.slug}>
          <Link
            href={`/admin/integrations/${card.slug}`}
            className="group block rounded-md border border-hairline bg-surface-1/30 p-5 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-1/60"
          >
            <div className="flex items-start justify-between gap-x-4">
              <h3 className="text-card-title text-ink group-hover:text-ink">
                {card.title}
              </h3>
              <StatusPill status={card.status} />
            </div>
            <p className="mt-2 text-body-sm text-ink-subtle">
              {card.description}
            </p>
            <p className="mt-4 text-eyebrow uppercase text-ink-subtle/70 group-hover:text-primary">
              Configure →
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: Status }) {
  const cls = {
    success: "border-semantic-success/40 text-semantic-success",
    warning: "border-semantic-warning/40 text-semantic-warning",
    neutral: "border-hairline text-ink-subtle",
    error: "border-semantic-error/40 text-semantic-error",
  }[status.tone];
  const dotCls = {
    success: "bg-semantic-success",
    warning: "bg-semantic-warning",
    neutral: "bg-ink-subtle/50",
    error: "bg-semantic-error",
  }[status.tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-x-1.5 rounded-full border px-2 py-0.5 text-eyebrow uppercase ${cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
      {status.label}
    </span>
  );
}

// A redacted secret string of the form "••••XXXX" means the secret is
// present (configured). Empty string means it's not set. This mirrors
// how getIntegrationConfigRedacted formats values.
function redactedSecretToStatus(redacted: string): Status {
  if (redacted && redacted.length > 0) {
    return { tone: "success", label: "Configured" };
  }
  return { tone: "neutral", label: "Not configured" };
}

function googleStatusToStatus(
  status: "pending" | "ok" | "stale" | "not_configured",
): Status {
  switch (status) {
    case "ok":
      return { tone: "success", label: "Connected" };
    case "stale":
      return { tone: "warning", label: "Stale" };
    case "pending":
    case "not_configured":
      return { tone: "neutral", label: "Not connected" };
  }
}
