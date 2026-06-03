import "server-only";
import { getIntegrationConfig } from "@/lib/integration-config";

export interface AuthClientConfig {
  turnstileSiteKey: string | null;
  googleOauthEnabled: boolean;
}

// Server-only resolver for the public bits the auth forms need.
// Both Turnstile and Google OAuth credentials live in /admin/integrations.
// The sign-in OAuth flow reuses the same client ID + secret as the
// booking integration (different scopes + redirect URI, same credentials).
export async function getAuthClientConfig(): Promise<AuthClientConfig> {
  try {
    const config = await getIntegrationConfig();
    return {
      turnstileSiteKey: config.turnstileSiteKey ?? null,
      googleOauthEnabled: Boolean(
        config.googleOauthClientId && config.googleOauthClientSecret,
      ),
    };
  } catch {
    return { turnstileSiteKey: null, googleOauthEnabled: false };
  }
}
