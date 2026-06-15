import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import * as projectService from "@/lib/projects/service";
import { createColumnSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/columns — list a project's columns. Any member.
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
    const columns = await kanbanService.listColumns(ctx.orgId, id);
    return Response.json({ ok: true, columns });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/columns — create a column. Any member (work surface).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createColumnSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const column = await kanbanService.createColumn(ctx.orgId, id, parsed.data);
    if (!column) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    return Response.json({ ok: true, column }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
