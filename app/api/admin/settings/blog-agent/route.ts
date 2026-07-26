import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { siteSetting } from "../../../../../lib/db/schema";
import {
  BLOG_AGENT_CONFIG_STARTER,
  BlogAgentConfigSchema,
  CONFIG_KEY,
} from "../../../../../lib/blog-agent/config-shared";

// GET/PUT for the blog agent's runtime config.
//
// This is the surface behind the kill switch. Until it existed, the only way
// to stop the agent was a hand-written UPDATE against site_setting, and the
// runbook pointed at an /admin/prompts URL that 404'd because the slug was
// never registered.
//
// Mirrors app/api/admin/settings/chat-prompt/route.ts. Gated by proxy.ts like
// every other admin route.

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value, updatedAt: siteSetting.updatedAt })
      .from(siteSetting)
      .where(eq(siteSetting.key, CONFIG_KEY))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({
        ok: true,
        data: BLOG_AGENT_CONFIG_STARTER,
        updatedAt: null,
        isFallback: true,
      });
    }

    const parsed = BlogAgentConfigSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      // Say which fields are wrong rather than silently showing the starter.
      // A config that fails validation means the agent is running on the
      // disabled starter right now, and the operator needs to know that.
      return Response.json({
        ok: true,
        data: BLOG_AGENT_CONFIG_STARTER,
        updatedAt: rows[0].updatedAt,
        isFallback: true,
        invalidFields: parsed.error.issues.map((i) => i.path.join(".")),
      });
    }

    return Response.json({
      ok: true,
      data: parsed.data,
      updatedAt: rows[0].updatedAt,
      isFallback: false,
    });
  } catch (err) {
    console.error("Blog agent config GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load the settings." },
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

  const parsed = BlogAgentConfigSchema.safeParse(body);
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
      .values({ key: CONFIG_KEY, value: parsed.data })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: parsed.data, updatedAt: new Date() },
      });
    return Response.json({ ok: true, data: parsed.data });
  } catch (err) {
    console.error("Blog agent config PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save the settings." },
      { status: 500 },
    );
  }
}
