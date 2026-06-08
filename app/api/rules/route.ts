import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createRuleSchema } from "@/lib/rules/validation";
import * as ruleService from "@/lib/rules/service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const rules = await ruleService.listRules(auth.user.id);
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const rule = await ruleService.createRule(parsed.data, auth.user.id);
  return NextResponse.json({ rule }, { status: 201 });
}
