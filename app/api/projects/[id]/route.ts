import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as projectService from "@/lib/projects/service";
import { updateProjectSchema } from "@/lib/projects/validation";

export const runtime = "nodejs";

// GET /api/projects/:id — fetch one project. Any member.
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
    return Response.json({ ok: true, project });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// PATCH /api/projects/:id — update a project. Owner or admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const project = await projectService.updateProject(ctx.orgId, id, parsed.data);
    if (!project) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    return Response.json({ ok: true, project });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// DELETE /api/projects/:id — delete a project. Owner or admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { id } = await params;

    const removed = await projectService.deleteProject(ctx.orgId, id);
    if (!removed) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
