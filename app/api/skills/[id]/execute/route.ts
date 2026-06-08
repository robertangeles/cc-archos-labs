import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { executeSkillSchema } from "@/lib/skills/validation";
import * as skillService from "@/lib/skills/service";
import { executeSkill, ExecuteError } from "@/lib/skills/execute";
import { recordSkillExecution } from "@/lib/skills/execution-tracking";

export const runtime = "nodejs";

export async function POST(
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

  const { id } = await params;
  const skill = await skillService.getSkill(id, auth.user.id);
  if (!skill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = executeSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const requiredInputs = skill.inputs.filter((i) => i.isRequired);
  for (const inp of requiredInputs) {
    if (!parsed.data.inputs[inp.key]?.trim()) {
      return NextResponse.json(
        { error: `Missing required input: ${inp.label}` },
        { status: 400 },
      );
    }
  }

  const model =
    parsed.data.model ?? skill.defaultModel ?? "anthropic/claude-sonnet-4.6";

  try {
    const result = await executeSkill({
      promptTemplate: skill.promptTemplate,
      systemPrompt: skill.systemPrompt,
      inputs: parsed.data.inputs,
      model,
      temperature: skill.temperature ? Number(skill.temperature) : undefined,
      maxTokens: skill.maxTokens ?? undefined,
    });

    try {
      await recordSkillExecution({
        userId: auth.user.id,
        skillId: skill.id,
        model,
        tokenCount: result.usage
          ? result.usage.inputTokens + result.usage.outputTokens
          : null,
      });
    } catch (trackingErr) {
      console.error("[skills/execute] Failed to record execution:", trackingErr);
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ExecuteError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    console.error("[skills/execute] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
