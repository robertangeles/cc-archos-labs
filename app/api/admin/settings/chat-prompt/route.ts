import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import {
  CHAT_PROMPT_STARTER,
  ChatPromptSchema,
  SITE_SETTING_KEY,
} from "../../../../../lib/chat/prompt-config-shared";

export const runtime = "nodejs";

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
        data: CHAT_PROMPT_STARTER,
        updatedAt: null,
        isFallback: true,
      });
    }

    const parsed = ChatPromptSchema.safeParse(rows[0].value);
    return Response.json({
      ok: true,
      data: parsed.success ? parsed.data : CHAT_PROMPT_STARTER,
      updatedAt: rows[0].updatedAt,
      isFallback: !parsed.success,
    });
  } catch (err) {
    console.error("Chat prompt GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load prompt." },
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

  const parsed = ChatPromptSchema.safeParse(body);
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
    console.error("Chat prompt PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save prompt." },
      { status: 500 },
    );
  }
}
