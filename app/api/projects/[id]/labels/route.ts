import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { createLabelSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/labels — a project's label definitions. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { id } = await params;
    const labels = await kanbanService.listLabels(ctx.orgId, id);
    return Response.json({ ok: true, labels });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/labels — create a label in a project. Any member.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createLabelSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const label = await kanbanService.createLabel(ctx.orgId, id, parsed.data);
    if (!label) {
      return Response.json(
        { ok: false, error: "Project not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, label }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
