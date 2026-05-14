import { z } from "zod";
import { randomBytes } from "node:crypto";
import { rotateMasterKey } from "../../../../../lib/integration-config";
import {
  IntegrationConfigError,
  IntegrationConfigDecryptError,
} from "../../../../../lib/errors/integration-config";

export const runtime = "nodejs";

// POST /api/admin/integrations/rotate-master-key
//   Body (optional): { newKey?: "<32-byte base64>" }
//   - If newKey omitted: generates a fresh 32-byte key server-side.
//   - If newKey provided: must be 32 bytes base64 (admin chose their own).
//
// Returns:
//   { ok: true, newKey, fieldsRotated, instructions }
//
// The new key is returned to the caller so the admin can copy it into
// the Render dashboard BOOKING_ENCRYPTION_KEY env var. Until they do
// AND restart the service, the running process still has the old key
// cached. After restart, the process reads the new key from env and
// decrypts the just-re-encrypted DB row.
//
// CRITICAL: This endpoint mutates the DB BEFORE the env var is updated.
// If the admin closes the browser tab between rotation and Render
// update, the next deploy/restart will fail decryption. Recovery is
// to run pnpm rotate-master-key --old <new> --new <old> from a shell
// (swap them back). Documented in wiki/runbooks/rotate-master-key.md.

const BodySchema = z.object({
  newKey: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || isValidBase64Key(v),
      "newKey must decode to exactly 32 bytes (base64)",
    ),
});

function isValidBase64Key(b64: string): boolean {
  try {
    return Buffer.from(b64, "base64").length === 32;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const oldKeyBase64 = process.env.BOOKING_ENCRYPTION_KEY;
  if (!oldKeyBase64) {
    return Response.json(
      {
        ok: false,
        error: "BOOKING_ENCRYPTION_KEY not set on the running process — cannot rotate.",
      },
      { status: 503 },
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — we'll generate a fresh key below.
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      },
      { status: 400 },
    );
  }

  const newKeyBase64 =
    parsed.data.newKey ?? randomBytes(32).toString("base64");

  // Reject same-key rotation (no-op + confusing).
  if (oldKeyBase64 === newKeyBase64) {
    return Response.json(
      {
        ok: false,
        error: "New key matches current key — nothing to rotate.",
      },
      { status: 400 },
    );
  }

  try {
    const { fieldsRotated } = await rotateMasterKey(
      oldKeyBase64,
      newKeyBase64,
    );

    return Response.json({
      ok: true,
      fieldsRotated,
      newKey: newKeyBase64,
      instructions: [
        "1. Copy the new key above.",
        "2. Open Render dashboard → service → Environment.",
        "3. Update BOOKING_ENCRYPTION_KEY to the new key.",
        "4. Save (Render will restart the service automatically).",
        "5. Verify /admin/integrations still loads — proves decrypt works with new key.",
        "If anything goes wrong: run `pnpm rotate-master-key --old <new> --new <old>` from a shell to swap them back.",
      ],
    });
  } catch (err) {
    console.error("[admin/integrations/rotate-master-key] failed:", err);
    if (err instanceof IntegrationConfigDecryptError) {
      return Response.json(
        {
          ok: false,
          error:
            "Old master key cannot decrypt the existing DB row. The running process may have an outdated key.",
        },
        { status: 500 },
      );
    }
    if (err instanceof IntegrationConfigError) {
      return Response.json(
        { ok: false, error: err.message },
        { status: 500 },
      );
    }
    return Response.json(
      { ok: false, error: "Rotation failed. Check server logs." },
      { status: 500 },
    );
  }
}
