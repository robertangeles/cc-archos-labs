import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { executeWorkflowSchema } from "@/lib/workflows/validation";
import { executeWorkflow } from "@/lib/workflows/executor";
import * as workflowService from "@/lib/workflows/service";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const wf = await workflowService.getWorkflow(id, auth.user.id);
  if (!wf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = executeWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const result = await executeWorkflow(id, auth.user.id, parsed.data.inputs);
    return NextResponse.json({ execution: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
