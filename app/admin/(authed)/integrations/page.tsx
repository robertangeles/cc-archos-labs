import { desc } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { integrationSecretAudit } from "../../../../lib/db/schema";
import {
  getIntegrationConfigRedacted,
} from "../../../../lib/integration-config";
import { IntegrationsPanel } from "../../../../components/admin/integrations/integrations-panel";

// /admin/integrations — read-edit-rotate Settings page for the
// DB-backed integration_secrets row. Server-side renders the initial
// redacted view + recent audit log, then hands off to the client
// panel for interactive edits.
//
// Gated by proxy.ts (admin session required).

export const dynamic = "force-dynamic";

export default async function IntegrationsAdminPage() {
  let initialConfig: Awaited<ReturnType<typeof getIntegrationConfigRedacted>> | null = null;
  let initialError: string | null = null;
  try {
    initialConfig = await getIntegrationConfigRedacted();
  } catch (err) {
    console.error("[admin/integrations page] config load failed:", err);
    initialError =
      err instanceof Error
        ? err.message
        : "Integration config is unreadable.";
  }

  let initialAudit: Array<{
    id: string;
    keyName: string;
    operation: string;
    actor: string;
    createdAt: string;
  }> = [];
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: integrationSecretAudit.id,
        keyName: integrationSecretAudit.keyName,
        operation: integrationSecretAudit.operation,
        actor: integrationSecretAudit.actor,
        createdAt: integrationSecretAudit.createdAt,
      })
      .from(integrationSecretAudit)
      .orderBy(desc(integrationSecretAudit.createdAt))
      .limit(20);
    initialAudit = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[admin/integrations page] audit load failed:", err);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          Integrations
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          API keys, credentials, and integration configuration. Secrets are
          encrypted at rest with the master key in <code className="rounded bg-surface px-1 py-0.5 text-xs">BOOKING_ENCRYPTION_KEY</code>.
          Edits take effect on the next request after save.
        </p>
      </header>

      {initialError ? (
        <div className="rounded-md border border-rule bg-surface/50 p-6 text-sm text-muted">
          <p className="font-medium text-fg">
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
        <IntegrationsPanel
          initialConfig={initialConfig}
          initialAudit={initialAudit}
        />
      ) : null}
    </div>
  );
}
