import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as workflowService from "@/lib/workflows/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
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
  const duplicated = await workflowService.duplicateWorkflow(id, auth.user.id);
  if (!duplicated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ workflow: duplicated }, { status: 201 });
}
