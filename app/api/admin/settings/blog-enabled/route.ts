import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import { clearBlogEnabledCache } from "../../../../../lib/blog/feature-flag";

export const runtime = "nodejs";

// Admin toggle for the /blog public surface. Stored as
//   site_setting.key='blog_enabled', value={enabled: bool}
// to leave room for future fields without a schema change. Gated by
// middleware.ts — unauthed requests get 401 upstream.

const KEY = "blog_enabled";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value, updatedAt: siteSetting.updatedAt })
      .from(siteSetting)
      .where(eq(siteSetting.key, KEY))
      .limit(1);
    if (rows.length === 0) {
      return Response.json({ ok: true, enabled: false, updatedAt: null });
    }
    const stored = rows[0].value as Record<string, unknown>;
    const enabled = stored.enabled === true;
    return Response.json({
      ok: true,
      enabled,
      updatedAt: rows[0].updatedAt,
    });
  } catch (err) {
    console.error("blog-enabled GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load flag." },
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
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).enabled !== "boolean"
  ) {
    return Response.json(
      { ok: false, error: "Body must be {enabled: boolean}." },
      { status: 400 },
    );
  }
  const enabled = (body as { enabled: boolean }).enabled;

  try {
    const db = getDb();
    await db
      .insert(siteSetting)
      .values({ key: KEY, value: { enabled } })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: { enabled }, updatedAt: new Date() },
      });
    clearBlogEnabledCache();
    return Response.json({ ok: true, enabled });
  } catch (err) {
    console.error("blog-enabled PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save flag." },
      { status: 500 },
    );
  }
}
