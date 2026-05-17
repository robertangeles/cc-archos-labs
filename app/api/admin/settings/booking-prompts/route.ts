import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import {
  BOOKING_PROMPTS_STARTER,
  BookingPromptsSchema,
  SITE_SETTING_KEY,
} from "../../../../../lib/booking-prompts-shared";

export const runtime = "nodejs";

// GET — current booking prompts (followup + brief + blogMatch), or
//       starter fallback when no admin-saved row exists. isFallback=true
//       signals the UI to show "starter — edit to override" badging.
// PUT — full replace of the row (upsert). All three prompts in one
//       transaction so the admin can save them atomically.
//
// Gated by proxy.ts — unauthenticated callers get 401 before reaching
// here. No rate limit because admin-only.

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value, updatedAt: siteSetting.updatedAt })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({
        ok: true,
        data: BOOKING_PROMPTS_STARTER,
        updatedAt: null,
        isFallback: true,
      });
    }

    const parsed = BookingPromptsSchema.safeParse(rows[0].value);
    return Response.json({
      ok: true,
      data: parsed.success ? parsed.data : BOOKING_PROMPTS_STARTER,
      updatedAt: rows[0].updatedAt,
      isFallback: !parsed.success,
    });
  } catch (err) {
    console.error("Booking prompts GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load booking prompts." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = BookingPromptsSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      {
        ok: false,
        error: `${first?.path.join(".") || "field"}: ${
          first?.message ?? "Invalid value."
        }`,
      },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    await db
      .insert(siteSetting)
      .values({ key: SITE_SETTING_KEY, value: parsed.data })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: parsed.data, updatedAt: new Date() },
      });
    return Response.json({ ok: true, data: parsed.data });
  } catch (err) {
    console.error("Booking prompts PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save booking prompts." },
      { status: 500 },
    );
  }
}
