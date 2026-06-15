import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as projectService from "@/lib/projects/service";
import { addProjectMemberSchema } from "@/lib/projects/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/members — list a project's members. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { id } = await params;
    // Confirm the project exists in the org so a missing project is a 404, not
    // an empty list for an id the caller has no business querying.
    const project = await projectService.getProject(ctx.orgId, id);
    if (!project) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    const members = await projectService.listProjectMembers(ctx.orgId, id);
    return Response.json({ ok: true, members });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/members — add a member. Owner or admin.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = addProjectMemberSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const member = await projectService.addProjectMember(
      ctx.orgId,
      id,
      parsed.data.userId,
      parsed.data.role ?? "member",
    );
    if (!member) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    return Response.json({ ok: true, member }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
