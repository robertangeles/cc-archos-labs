import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { integrationSecretAudit } from "../../../../lib/db/schema";
import {
  getIntegrationConfigRedacted,
  updateIntegrationSecret,
} from "../../../../lib/integration-config";
import { IntegrationConfigSchema } from "../../../../lib/integration-config-shared";
import {
  IntegrationConfigError,
  IntegrationConfigValidationError,
} from "../../../../lib/errors/integration-config";

export const runtime = "nodejs";

// GET  /api/admin/integrations
//   Returns: { config: { adminPassword: "••••3a72", ... }, audit: [...] }
//   Auth: gated by proxy.ts (any signed-in admin session).
//
// PATCH /api/admin/integrations
//   Body: { field: "<known key>", value: <string|null> }
//   Updates a single field. Encrypts if it's a secret. Writes audit row.
//   Returns: { ok: true, redacted: "<new redacted display>" }
//
// No PUT (no full-replace; edits are field-by-field to keep the audit
// log meaningful). No DELETE (clearing a value sets it to empty string,
// which Zod rejects — by design).

const PATCH_FIELDS = [
  "adminPassword",
  "resendApiKey",
  "llmApiKey",
  "contactRecipientEmail",
  "resendFromEmail",
  "llmModelId",
] as const;

const PatchSchema = z.object({
  field: z.enum(PATCH_FIELDS),
  // Validated downstream against the field's specific Zod rule inside
  // updateIntegrationSecret. Here we just enforce string|null at the
  // wire boundary. llmModelId is the only field that legitimately
  // takes null (signals "use the default model").
  value: z.union([z.string(), z.null()]),
});

export async function GET() {
  try {
    const db = getDb();
    const [config, audit] = await Promise.all([
      getIntegrationConfigRedacted(),
      db
        .select({
          id: integrationSecretAudit.id,
          keyName: integrationSecretAudit.keyName,
          operation: integrationSecretAudit.operation,
          actor: integrationSecretAudit.actor,
          createdAt: integrationSecretAudit.createdAt,
        })
        .from(integrationSecretAudit)
        .orderBy(desc(integrationSecretAudit.createdAt))
        .limit(20),
    ]);

    return Response.json({ ok: true, config, audit });
  } catch (err) {
    console.error("[admin/integrations GET] failed:", err);
    if (err instanceof IntegrationConfigError) {
      return Response.json(
        {
          ok: false,
          error: `Integration config unreadable: ${err.message}`,
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        ok: false,
        error: "Failed to load integration config.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      },
      { status: 400 },
    );
  }

  // Field-specific schema validation. updateIntegrationSecret will
  // also validate, but failing here gives a clearer error message
  // pointing at the field name.
  const { field, value } = parsed.data;
  const fieldSchema = IntegrationConfigSchema.shape[field];
  const fieldCheck = fieldSchema.safeParse(value);
  if (!fieldCheck.success) {
    return Response.json(
      {
        ok: false,
        error:
          fieldCheck.error.issues[0]?.message ?? `Invalid value for ${field}.`,
        field,
      },
      { status: 400 },
    );
  }

  try {
    // Type-system gymnastics: parsed.data.value is string|null but
    // updateIntegrationSecret's `newValue` parameter is constrained
    // to IntegrationConfig[field]. The Zod check above proves the
    // shape is correct; the assertion narrows the type.
    await updateIntegrationSecret(field, fieldCheck.data, "admin");

    // Return the freshly redacted display so the UI can update
    // optimistically without a round-trip.
    const fresh = await getIntegrationConfigRedacted();
    return Response.json({
      ok: true,
      field,
      redacted: fresh[field],
    });
  } catch (err) {
    console.error("[admin/integrations PATCH] failed:", err);
    if (err instanceof IntegrationConfigValidationError) {
      return Response.json(
        { ok: false, error: err.message, fields: err.fields },
        { status: 400 },
      );
    }
    return Response.json(
      { ok: false, error: "Failed to update integration secret." },
      { status: 500 },
    );
  }
}
