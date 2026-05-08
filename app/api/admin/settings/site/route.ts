import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import {
  SITE_DEFAULTS,
  SiteSettingsSchema,
} from "../../../../../lib/site-config-shared";

export const runtime = "nodejs";

// GET — current site settings, with defaults if the row is missing.
// PUT — full replace of the site settings row (upsert). The admin form
// always sends the entire object so we don't need partial-update merges.
//
// Both routes are gated by middleware.ts — unauthenticated callers get
// 401 before they reach this handler.

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value, updatedAt: siteSetting.updatedAt })
      .from(siteSetting)
      .where(eq(siteSetting.key, "site"))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({
        ok: true,
        data: SITE_DEFAULTS,
        updatedAt: null,
      });
    }

    const stored = rows[0].value as Record<string, unknown>;
    const merged = { ...SITE_DEFAULTS, ...stored };
    const parsed = SiteSettingsSchema.safeParse(merged);
    return Response.json({
      ok: true,
      data: parsed.success ? parsed.data : SITE_DEFAULTS,
      updatedAt: rows[0].updatedAt,
    });
  } catch (err) {
    console.error("Site settings GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load settings." },
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

  const parsed = SiteSettingsSchema.safeParse(body);
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
      .values({ key: "site", value: parsed.data })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: parsed.data, updatedAt: new Date() },
      });
    return Response.json({ ok: true, data: parsed.data });
  } catch (err) {
    console.error("Site settings PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save settings." },
      { status: 500 },
    );
  }
}
