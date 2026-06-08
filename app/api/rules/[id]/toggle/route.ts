import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { toggleRuleSchema } from "@/lib/rules/validation";
import * as ruleService from "@/lib/rules/service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const parsed = toggleRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const toggled = await ruleService.toggleRule(
    id,
    parsed.data.isEnabled,
    auth.user.id,
  );
  if (!toggled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, isEnabled: toggled.isEnabled });
}
