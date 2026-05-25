import { z } from "zod";
import {
  getAuthSettings,
  updateAuthSettings,
  type AuthSettingsPatch,
} from "../../../../lib/auth/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/auth-settings  → redacted current settings
// PATCH /api/admin/auth-settings → partial update
//
// Gated by proxy.ts (admin session). No additional auth check here.
//
// Secrets: turnstileSecretKey is write-only — GET never reveals the
// value, only whether one is set (turnstileHasSecret boolean). To clear
// a secret, send `null` explicitly. Empty string is ignored (so the
// UI's blank password field doesn't accidentally wipe an existing key).

export async function GET(): Promise<Response> {
  const settings = await getAuthSettings();
  return Response.json({ ok: true, settings });
}

const PatchSchema = z.object({
  turnstileEnabled: z.boolean().optional(),
  turnstileSiteKey: z.union([z.string().max(256), z.null()]).optional(),
  turnstileSecretKey: z.union([z.string().max(2048), z.null()]).optional(),
  publicSignupEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Hard guard: if the admin tries to enable Turnstile, we must have a
  // secret available (either in this PATCH or already stored). Refuse
  // otherwise — saves them from a broken "enabled but won't verify"
  // state that silently rejects every register/login attempt.
  if (parsed.data.turnstileEnabled === true) {
    const current = await getAuthSettings();
    const willHaveSecret =
      typeof parsed.data.turnstileSecretKey === "string" &&
      parsed.data.turnstileSecretKey.length > 0;
    if (!willHaveSecret && !current.turnstileHasSecret) {
      return Response.json(
        {
          ok: false,
          error:
            "Cannot enable Turnstile without a secret key. Paste your Cloudflare secret first.",
        },
        { status: 400 },
      );
    }
  }

  const updated = await updateAuthSettings(parsed.data as AuthSettingsPatch);
  return Response.json({ ok: true, settings: updated });
}
