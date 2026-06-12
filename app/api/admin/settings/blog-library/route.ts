import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import {
  BLOG_LIBRARY_STARTER,
  BlogLibrarySchema,
  SITE_SETTING_KEY,
} from "../../../../../lib/blog-library-shared";

export const runtime = "nodejs";

// GET — current blog library entries, or empty starter when no admin-
//       saved row exists. isFallback=true signals the UI to show
//       "no entries yet" badging.
// PUT — full replace of the row (upsert). Zod-validated array of
//       {title, url, summary} triples.
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
        data: BLOG_LIBRARY_STARTER,
        updatedAt: null,
        isFallback: true,
      });
    }

    const parsed = BlogLibrarySchema.safeParse(rows[0].value);
    return Response.json({
      ok: true,
      data: parsed.success ? parsed.data : BLOG_LIBRARY_STARTER,
      updatedAt: rows[0].updatedAt,
      isFallback: !parsed.success,
    });
  } catch (err) {
    console.error("Blog library GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load blog library." },
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

  const parsed = BlogLibrarySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      {
        ok: false,
        error: `${first?.path.join(".") || "entry"}: ${
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
    console.error("Blog library PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save blog library." },
      { status: 500 },
    );
  }
}
