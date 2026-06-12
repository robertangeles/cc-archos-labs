import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../../lib/db";
import { consultant } from "../../../../../lib/db/schema";
import { getIntegrationConfig } from "../../../../../lib/integration-config";

export const runtime = "nodejs";

// GET  — current consultant profile fields
// PATCH — partial update of editable consultant fields
//
// Identifies "the consultant" the same way the booking system does:
// consultant.email === integration_config.contact_recipient_email.
//
// Gated by proxy.ts — admin session required.

const PatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
        "Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphen",
      )
      .optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    publicEmail: z.string().email().max(320).nullable().optional(),
    slotMinutes: z.number().int().min(10).max(180).optional(),
    slotBufferMinutes: z.number().int().min(0).max(120).optional(),
    advanceDays: z.number().int().min(1).max(90).optional(),
    minNoticeHours: z.number().int().min(0).max(168).optional(),
    workingHoursJson: z
      .record(
        z.string(),
        z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]),
      )
      .optional(),
  })
  .strict();

async function findConsultant() {
  const config = await getIntegrationConfig();
  const email = config.contactRecipientEmail;
  const db = getDb();
  const rows = await db
    .select({
      id: consultant.id,
      slug: consultant.slug,
      displayName: consultant.displayName,
      email: consultant.email,
      publicEmail: consultant.publicEmail,
      timezone: consultant.timezone,
      slotMinutes: consultant.slotMinutes,
      slotBufferMinutes: consultant.slotBufferMinutes,
      advanceDays: consultant.advanceDays,
      minNoticeHours: consultant.minNoticeHours,
      workingHoursJson: consultant.workingHoursJson,
    })
    .from(consultant)
    .where(eq(consultant.email, email))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET() {
  try {
    const row = await findConsultant();
    if (!row) {
      return Response.json(
        { ok: false, error: "Consultant not found." },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, data: row });
  } catch (err) {
    console.error("[admin/consultant/profile] GET failed:", err);
    return Response.json(
      { ok: false, error: "Could not load consultant profile." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? `Invalid input: ${err.issues[0]?.path.join(".") ?? "field"} — ${err.issues[0]?.message ?? "bad value"}`
        : "Invalid JSON body.";
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return Response.json(
      { ok: false, error: "No fields to update." },
      { status: 400 },
    );
  }

  try {
    const row = await findConsultant();
    if (!row) {
      return Response.json(
        { ok: false, error: "Consultant not found." },
        { status: 404 },
      );
    }

    if (body.slug && body.slug !== row.slug) {
      const db = getDb();
      const existing = await db
        .select({ id: consultant.id })
        .from(consultant)
        .where(eq(consultant.slug, body.slug))
        .limit(1);
      if (existing.length > 0) {
        return Response.json(
          { ok: false, error: "That slug is already taken." },
          { status: 409 },
        );
      }
    }

    const db = getDb();
    await db
      .update(consultant)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(consultant.id, row.id));

    const updated = await findConsultant();
    return Response.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[admin/consultant/profile] PATCH failed:", err);
    return Response.json(
      { ok: false, error: "Could not update consultant profile." },
      { status: 500 },
    );
  }
}
