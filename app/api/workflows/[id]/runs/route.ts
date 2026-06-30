import { getCurrentUser } from "@/lib/auth/current-user";
import * as workflowService from "@/lib/workflows/service";
import { listRuns } from "@/lib/workflows/runs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;

  const wf = await workflowService.getWorkflow(id, auth.user.id);
  if (!wf) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const runs = await listRuns(id);
  return Response.json({ runs });
}
