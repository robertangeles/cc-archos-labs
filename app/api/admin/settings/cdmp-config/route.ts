import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionFromCookies } from "@/lib/auth-server";
import { getDb } from "@/lib/db";
import { siteSetting } from "@/lib/db/schema";
import {
  CdmpConfigSchema,
  CDMP_CONFIG_STARTER,
} from "@/lib/cdmp/config-shared";

const KEY = "cdmp_config";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, KEY))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      data: CDMP_CONFIG_STARTER,
      isFallback: true,
    });
  }

  return NextResponse.json({ ok: true, data: rows[0].value, isFallback: false });
}

export async function PUT(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CdmpConfigSchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { error: `Validation failed: ${fields}` },
      { status: 400 },
    );
  }

  const db = getDb();
  const existing = await db
    .select({ id: siteSetting.id })
    .from(siteSetting)
    .where(eq(siteSetting.key, KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(siteSetting)
      .set({ value: parsed.data, updatedAt: new Date() })
      .where(eq(siteSetting.key, KEY));
  } else {
    await db
      .insert(siteSetting)
      .values({ key: KEY, value: parsed.data });
  }

  return NextResponse.json({ ok: true });
}
