import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { consultant } from "../../../../lib/db/schema";
import { getIntegrationConfig } from "../../../../lib/integration-config";
import { GoogleConnectPanel } from "./google-connect-panel";

// /admin/google — manage the Book-a-Call Google Calendar grant.
//
// Single-consultant v1: the consultant row is keyed by
// integration_secrets.contactRecipientEmail. This page reads the
// current grant status from `consultant.google_status` and renders the
// connect / disconnect controls. The actual OAuth flow lives in
// /api/admin/google-oauth/{start,cb,disconnect}.

export const dynamic = "force-dynamic";

type Status = "pending" | "ok" | "stale" | "not_configured";

interface PageProps {
  searchParams: Promise<{ status?: string; detail?: string }>;
}

export default async function GoogleAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const banner = bannerFor(params.status, params.detail);

  let status: Status = "not_configured";
  let consultantEmail: string | null = null;
  let displayName: string | null = null;
  let configError: string | null = null;

  try {
    const config = await getIntegrationConfig();
    consultantEmail = config.contactRecipientEmail;
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
      status = rows[0].googleStatus as Status;
    } else {
      status = "pending";
    }
  } catch (err) {
    console.error("[admin/google page] config load failed:", err);
    configError =
      err instanceof Error
        ? err.message
        : "Integration config is unreadable.";
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Google Calendar</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          Connect a Google account so the Book-a-Call flow can read your
          availability, create events on your calendar, and attach Meet
          links. The refresh token is encrypted at rest using the same
          master key as the integration secrets.
        </p>
      </header>

      {banner ? (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            banner.tone === "success"
              ? "border-semantic-success/40 bg-semantic-success/5 text-semantic-success"
              : "border-semantic-error/40 bg-semantic-error/5 text-semantic-error"
          }`}
        >
          <p className="font-medium">{banner.title}</p>
          {banner.detail ? <p className="mt-1 text-ink-subtle">{banner.detail}</p> : null}
        </div>
      ) : null}

      {configError ? (
        <div className="rounded-md border border-hairline bg-surface-1/50 p-6 text-sm text-ink-subtle">
          <p className="font-medium text-ink">
            Could not load integration config.
          </p>
          <p className="mt-2">{configError}</p>
        </div>
      ) : (
        <GoogleConnectPanel
          status={status}
          consultantEmail={consultantEmail}
          displayName={displayName}
        />
      )}
    </div>
  );
}

function bannerFor(
  status: string | undefined,
  detail: string | undefined,
): { tone: "success" | "error"; title: string; detail?: string } | null {
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
