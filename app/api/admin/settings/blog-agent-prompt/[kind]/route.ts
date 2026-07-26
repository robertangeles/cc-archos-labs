import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../lib/db";
import { siteSetting } from "../../../../../../lib/db/schema";
import {
  JUDGE_PROMPT_KEY,
  JUDGE_PROMPT_STARTER,
  JudgePromptSchema,
  PLAN_PROMPT_KEY,
  PLAN_PROMPT_STARTER,
} from "../../../../../../lib/blog-agent/config-shared";

// GET/PUT for the blog agent's two editable prompts.
//
// One route rather than two because both are the same `{systemPrompt, version}`
// shape — PlanPromptSchema is literally JudgePromptSchema. Splitting them would
// duplicate this file to change one constant.

export const runtime = "nodejs";

const KINDS = {
  judge: { key: JUDGE_PROMPT_KEY, starter: JUDGE_PROMPT_STARTER },
  plan: { key: PLAN_PROMPT_KEY, starter: PLAN_PROMPT_STARTER },
} as const;

type Kind = keyof typeof KINDS;

function resolve(raw: string): (typeof KINDS)[Kind] | null {
  // Object.hasOwn, not `in`. `"constructor" in KINDS` is true via the
  // prototype chain, so `in` returned Object.prototype.constructor here — a
  // truthy value whose `.key` is undefined, which sailed past the 404 and
  // reached the database with an undefined key. Caught by a penetration test.
  return Object.hasOwn(KINDS, raw) ? KINDS[raw as Kind] : null;
}

interface RouteContext {
  params: Promise<{ kind: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { kind } = await params;
  const target = resolve(kind);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown prompt." }, { status: 404 });
  }

  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value, updatedAt: siteSetting.updatedAt })
      .from(siteSetting)
      .where(eq(siteSetting.key, target.key))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({
        ok: true,
        data: target.starter,
        updatedAt: null,
        isFallback: true,
      });
    }

    const parsed = JudgePromptSchema.safeParse(rows[0].value);
    return Response.json({
      ok: true,
      data: parsed.success ? parsed.data : target.starter,
      updatedAt: rows[0].updatedAt,
      isFallback: !parsed.success,
    });
  } catch (err) {
    console.error(`Blog agent ${kind} prompt GET crash:`, err);
    return Response.json(
      { ok: false, error: "Could not load the prompt." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { kind } = await params;
  const target = resolve(kind);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown prompt." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = JudgePromptSchema.safeParse(body);
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
      .values({ key: target.key, value: parsed.data })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: parsed.data, updatedAt: new Date() },
      });
    return Response.json({ ok: true, data: parsed.data });
  } catch (err) {
    console.error(`Blog agent ${kind} prompt PUT crash:`, err);
    return Response.json(
      { ok: false, error: "Could not save the prompt." },
      { status: 500 },
    );
  }
}
