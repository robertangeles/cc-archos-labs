import { z } from "zod";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import {
  fingerprintSession,
  verifyRevealToken,
  REVEAL_COOKIE,
} from "../../../../../lib/admin-reveal-token";
import { getIntegrationConfig } from "../../../../../lib/integration-config";
import {
  ENCRYPTED_FIELDS,
  type EncryptedField,
} from "../../../../../lib/integration-config-shared";
import { getDb } from "../../../../../lib/db";
import { integrationSecretAudit } from "../../../../../lib/db/schema";

export const runtime = "nodejs";

// POST /api/admin/integrations/reveal
//   Body: { field: "adminPassword" | "resendApiKey" | "llmApiKey" }
//   Returns: { ok: true, value: "<plaintext>" } | 401
//
// Reveals one encrypted field as plaintext. Requires:
//   1. Valid admin session (proxy.ts gates this)
//   2. Valid reveal-auth cookie issued by /reveal-auth in the last 5 min
//   3. Reveal token's fingerprint matches THIS admin session (so a
//      reveal token from a previous logout can't be replayed)
//
// Every successful reveal writes an audit row with operation='revealed'.
// Failed reveals do NOT write audit rows — that's noise and amplifies
// any brute-force attempt against the password endpoint.

const BodySchema = z.object({
  field: z.enum(ENCRYPTED_FIELDS),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid field." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const adminSessionJwt = cookieStore.get(SESSION_COOKIE)?.value;
  const revealCookie = cookieStore.get(REVEAL_COOKIE)?.value;

  if (!adminSessionJwt) {
    return Response.json(
      { ok: false, error: "Not signed in." },
      { status: 401 },
    );
  }
  if (!revealCookie) {
    return Response.json(
      { ok: false, error: "Re-confirm your password to reveal secrets." },
      { status: 401 },
    );
  }

  const fingerprint = await fingerprintSession(adminSessionJwt);
  const revealPayload = await verifyRevealToken(revealCookie, fingerprint);
  if (!revealPayload) {
    return Response.json(
      {
        ok: false,
        error: "Reveal session expired. Re-confirm your password.",
      },
      { status: 401 },
    );
  }

  const field: EncryptedField = parsed.data.field;
  const config = await getIntegrationConfig();
  const plaintext = config[field];

  // Audit row: who revealed which secret, when.
  try {
    const db = getDb();
    await db.insert(integrationSecretAudit).values({
      keyName: camelToSnake(field),
      operation: "revealed",
      actor: "admin",
    });
  } catch (err) {
    // Audit log failure shouldn't block the reveal — log it and return
    // the value. The DB row missing is a recoverable observability gap.
    console.error("[admin/integrations/reveal] audit insert failed:", err);
  }

  return Response.json({ ok: true, value: plaintext });
}

function camelToSnake(input: string): string {
  return input.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
