import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as projectService from "@/lib/projects/service";

export const runtime = "nodejs";

// DELETE /api/projects/:id/members/:memberId — remove a member. Owner or admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id, memberId } = await params;

    const removed = await projectService.removeProjectMember(
      ctx.orgId,
      id,
      memberId,
    );
    if (!removed) {
      return Response.json(
        { ok: false, error: "Member not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
