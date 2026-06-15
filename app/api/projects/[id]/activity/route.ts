import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as projectService from "@/lib/projects/service";

export const runtime = "nodejs";

// GET /api/projects/:id/activity — the project's activity feed. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { id } = await params;
    const project = await projectService.getProject(ctx.orgId, id);
    if (!project) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    const activity = await projectService.listActivity(ctx.orgId, id);
    return Response.json({ ok: true, activity });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
