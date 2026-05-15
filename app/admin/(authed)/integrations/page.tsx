import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { consultant } from "../../../../lib/db/schema";
import { getIntegrationConfigRedacted } from "../../../../lib/integration-config";
import { IntegrationsGrid } from "../../../../components/admin/integrations/integrations-grid";

// /admin/integrations — index page. Renders a cards grid (one per
// integration) showing status at a glance. Each card drills down to
// /admin/integrations/[slug] for the full config + connect / disconnect
// controls.
//
// Pattern: Stripe Dashboard / Vercel integrations. Scales past the
// 5-section threshold where the old single-page accordion fell apart.
//
// Gated by proxy.ts (admin session required).

export const dynamic = "force-dynamic";

export default async function IntegrationsAdminPage() {
  let initialConfig: Awaited<
    ReturnType<typeof getIntegrationConfigRedacted>
  > | null = null;
  let initialError: string | null = null;
  try {
    initialConfig = await getIntegrationConfigRedacted();
  } catch (err) {
    console.error("[admin/integrations page] config load failed:", err);
    initialError =
      err instanceof Error ? err.message : "Integration config is unreadable.";
  }

  // Google Calendar status — read from the consultant row keyed by the
  // contactRecipientEmail config value. The grid card surfaces this
  // status without drilling down.
  let googleStatus: "pending" | "ok" | "stale" | "not_configured" =
    "not_configured";
  if (initialConfig) {
    try {
      const db = getDb();
      const rows = await db
        .select({ googleStatus: consultant.googleStatus })
        .from(consultant)
        .where(eq(consultant.email, initialConfig.contactRecipientEmail))
        .limit(1);
      if (rows[0]) {
        googleStatus = rows[0].googleStatus as typeof googleStatus;
      } else {
        googleStatus = "pending";
      }
    } catch (err) {
      console.error("[admin/integrations page] consultant lookup failed:", err);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Integrations</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          API keys, credentials, and third-party connections. Secrets are
          encrypted at rest with the master key in{" "}
          <code className="rounded bg-surface-1 px-1 py-0.5 text-xs">
            BOOKING_ENCRYPTION_KEY
          </code>
          . Edits take effect on the next request after save.
        </p>
      </header>

      {initialError ? (
        <div className="rounded-md border border-hairline bg-surface-1/50 p-6 text-sm text-ink-subtle">
          <p className="font-medium text-ink">
            Could not load integration config.
          </p>
          <p className="mt-2">{initialError}</p>
          <p className="mt-4">
            If you just rolled out the foundation PR, run{" "}
            <code className="rounded bg-canvas px-1 py-0.5 text-xs">
              pnpm migrate-integration-secrets
            </code>{" "}
            to seed the DB row, then refresh.
          </p>
        </div>
      ) : initialConfig ? (
        <IntegrationsGrid
          config={initialConfig}
          googleStatus={googleStatus}
        />
      ) : null}
    </div>
  );
}
