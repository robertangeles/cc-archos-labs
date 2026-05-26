import { getAuthSettings } from "../../../../lib/auth/settings";
import { AuthSettingsForm } from "./auth-settings-form";

export const dynamic = "force-dynamic";

// /admin/auth — Authentication settings UI.
//
// What ships in T8:
//   - Cloudflare Turnstile: enable toggle + site key + secret key
//   - Public sign-up enable toggle
//
// What lands in T8b (Google OAuth UI):
//   - Google OAuth: enable toggle + client id + client secret
//   - Until then, Google OAuth stays env-driven via GOOGLE_SIGNIN_*
//
// Gated by proxy.ts (admin session required).

export default async function AuthSettingsAdminPage() {
  const initial = await getAuthSettings();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Authentication</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          Controls for sign-in, bot protection, and account creation.
          Changes take effect immediately. Secrets are encrypted at rest
          with the master key in{" "}
          <code className="rounded bg-surface-1 px-1 py-0.5 text-xs">
            BOOKING_ENCRYPTION_KEY
          </code>
          .
        </p>
      </header>

      <AuthSettingsForm initial={initial} />
    </div>
  );
}
