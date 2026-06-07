import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createWorkflowSchema } from "@/lib/workflows/validation";
import * as workflowService from "@/lib/workflows/service";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const workflows = await workflowService.listWorkflows(auth.user.id);
  return NextResponse.json({ workflows });
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

  const parsed = createWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const wf = await workflowService.createWorkflow(parsed.data, auth.user.id);
  return NextResponse.json({ workflow: wf }, { status: 201 });
}
