import "server-only";
import { Resend } from "resend";
import { getIntegrationConfig } from "./integration-config";

// Server-only Resend client. Never imported into client components.
//
// Reads RESEND_API_KEY and RESEND_FROM_EMAIL from the DB-backed
// integration_secrets row via getIntegrationConfig(). During the
// 7-day grace window (INTEGRATION_FALLBACK_ENABLED=true) the loader
// falls back to env vars if the DB row is empty, so this works
// identically to the pre-migration behaviour.
//
// Cache strategy: getIntegrationConfig() already caches at the
// module level. We additionally cache the Resend SDK client per-key
// so the SDK isn't reconstructed on every send.

let cachedKey: string | null = null;
let cachedClient: Resend | null = null;

export async function getResend(): Promise<{ resend: Resend; from: string }> {
  const config = await getIntegrationConfig();
  const apiKey = config.resendApiKey;
  const fromEmail = config.resendFromEmail;

  if (!apiKey) {
    throw new Error(
      "Resend API key missing from integration config — run pnpm migrate-integration-secrets or set RESEND_API_KEY in env during the grace window.",
    );
  }
  if (!fromEmail) {
    throw new Error(
      "Resend From email missing from integration config — set via /admin/integrations or RESEND_FROM_EMAIL env during the grace window.",
    );
  }

  // Rebuild the SDK client if the key rotated. Comparing the raw key
  // here is the cheapest way to detect a change between reads.
  if (cachedClient === null || cachedKey !== apiKey) {
    cachedClient = new Resend(apiKey);
    cachedKey = apiKey;
  }

  return { resend: cachedClient, from: fromEmail };
}
