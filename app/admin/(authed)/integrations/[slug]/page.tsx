import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { consultant } from "../../../../../lib/db/schema";
import { getIntegrationConfigRedacted } from "../../../../../lib/integration-config";
import {
  IntegrationsPanel,
  type GoogleConnectInfo,
  type IntegrationSlug,
} from "../../../../../components/admin/integrations/integrations-panel";

// /admin/integrations/[slug] — detail page for one integration.
// Server-renders the redacted config (and Google connection state when
// slug='google-calendar') then hands off to the client IntegrationsPanel
// scoped to that view.

export const dynamic = "force-dynamic";

const VALID_SLUGS: ReadonlyArray<IntegrationSlug> = [
  "email",
  "ai-model",
  "authentication",
  "google-calendar",
  "anti-spam",
];

const TITLES: Record<IntegrationSlug, string> = {
  email: "Email (Resend)",
  "ai-model": "AI Model (OpenRouter)",
  authentication: "Authentication",
  "google-calendar": "Google Calendar",
  "anti-spam": "Anti-spam (Turnstile)",
};

const SUBTITLES: Record<IntegrationSlug, string> = {
  email:
    "Transactional + contact-form delivery. From-email + recipient routing live here.",
  "ai-model":
    "LLM provider key + model ID. Field names are provider-agnostic so future swaps reuse this row.",
  authentication:
    "Admin password, JWT signing key, master encryption key. Rotating the master key re-encrypts every secret in this table.",
  "google-calendar":
    "OAuth credentials + grant status. Connecting reads your availability and creates events with Meet links for booked calls.",
  "anti-spam":
    "Cloudflare Turnstile site + secret keys. Required to enable bot protection on the public booking form.",
};

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; detail?: string }>;
}

export default async function IntegrationDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug: rawSlug } = await params;
  if (!(VALID_SLUGS as ReadonlyArray<string>).includes(rawSlug)) {
    notFound();
  }
  const slug = rawSlug as IntegrationSlug;
  const queryParams = await searchParams;

  let initialConfig: Awaited<
    ReturnType<typeof getIntegrationConfigRedacted>
  > | null = null;
  let initialError: string | null = null;
  try {
    initialConfig = await getIntegrationConfigRedacted();
  } catch (err) {
    console.error("[admin/integrations/[slug] page] config load failed:", err);
    initialError =
      err instanceof Error ? err.message : "Integration config is unreadable.";
  }

  // Google-only extras: status + consultant identity rendered above the
  // OAuth credential fields. Only fetched when needed.
  let googleConnect: GoogleConnectInfo | undefined;
  if (slug === "google-calendar" && initialConfig) {
    googleConnect = await loadGoogleConnect(
      initialConfig.contactRecipientEmail,
      queryParams.status,
      queryParams.detail,
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/integrations"
          className="text-eyebrow uppercase text-ink-subtle hover:text-ink"
        >
          ← Integrations
        </Link>
        <h1 className="mt-2 text-headline text-ink">{TITLES[slug]}</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          {SUBTITLES[slug]}
        </p>
      </div>

      {initialError ? (
        <div className="rounded-md border border-hairline bg-surface-1/50 p-6 text-sm text-ink-subtle">
          <p className="font-medium text-ink">
            Could not load integration config.
          </p>
          <p className="mt-2">{initialError}</p>
        </div>
      ) : initialConfig ? (
        <IntegrationsPanel
          view={slug}
          initialConfig={initialConfig}
          googleConnect={googleConnect}
        />
      ) : null}
    </div>
  );
}

async function loadGoogleConnect(
  consultantEmail: string,
  statusQuery: string | undefined,
  detailQuery: string | undefined,
): Promise<GoogleConnectInfo> {
  const banner = bannerFor(statusQuery, detailQuery);
  let status: GoogleConnectInfo["status"] = "not_configured";
  let displayName: string | null = null;
  try {
    const db = getDb();
    const rows = await db
      .select({
        displayName: consultant.displayName,
        googleStatus: consultant.googleStatus,
      })
      .from(consultant)
      .where(eq(consultant.email, consultantEmail))
      .limit(1);
    if (rows[0]) {
      displayName = rows[0].displayName;
      status = rows[0].googleStatus as GoogleConnectInfo["status"];
    } else {
      status = "pending";
    }
  } catch (err) {
    console.error(
      "[admin/integrations/google-calendar] consultant lookup failed:",
      err,
    );
  }
  return {
    status,
    consultantEmail,
    displayName,
    banner,
  };
}

function bannerFor(
  status: string | undefined,
  detail: string | undefined,
): GoogleConnectInfo["banner"] {
  if (!status) return null;
  switch (status) {
    case "connected":
      return { tone: "success", title: "Google Calendar connected." };
    case "denied":
      return {
        tone: "error",
        title: "Consent cancelled.",
        detail: "You can re-start the flow at any time.",
      };
    case "state_mismatch":
      return {
        tone: "error",
        title: "Security check failed.",
        detail:
          "The OAuth state cookie did not match the URL. Re-start from this page so the cookie is freshly minted.",
      };
    case "no_code":
      return {
        tone: "error",
        title: "Missing authorization code.",
        detail: "Google did not return a code. Try again.",
      };
    case "error":
      return {
        tone: "error",
        title: "Could not complete the grant.",
        detail: detail ?? "Check server logs for the full error.",
      };
    default:
      return null;
  }
}
