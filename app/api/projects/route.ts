import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as projectService from "@/lib/projects/service";
import { createProjectSchema } from "@/lib/projects/validation";

export const runtime = "nodejs";

// GET /api/projects — list every project in the caller's org. Any member.
export async function GET(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request);
    const projects = await projectService.listProjects(ctx.orgId);
    return Response.json({ ok: true, projects });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects — create a project. Any member.
export async function POST(request: Request) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });

    const body = await request.json().catch(() => null);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const project = await projectService.createProject(
      ctx.orgId,
      auth.user.id,
      parsed.data,
    );
    return Response.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
