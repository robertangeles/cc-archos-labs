import { getCurrentUser } from "@/lib/auth/current-user";
import * as workflowService from "@/lib/workflows/service";
import { getRun } from "@/lib/workflows/runs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id, runId } = await params;

  const wf = await workflowService.getWorkflow(id, auth.user.id);
  if (!wf) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const run = await getRun(runId, id);
  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  return Response.json({ run });
}
