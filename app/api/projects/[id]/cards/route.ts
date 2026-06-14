import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as kanbanService from "@/lib/kanban/service";
import { createCardSchema } from "@/lib/kanban/validation";

export const runtime = "nodejs";

// GET /api/projects/:id/cards — the full board: columns with their cards. Any
// member. Returns 404 when the project is not in the caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { id } = await params;
    const board = await kanbanService.getBoard(ctx.orgId, id);
    if (!board) {
      return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    return Response.json({ ok: true, board });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/cards — create a card in a column. Any member.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const parsed = createCardSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const card = await kanbanService.createCard(
      ctx.orgId,
      id,
      parsed.data.columnId,
      parsed.data,
    );
    if (!card) {
      // Project not in org, or the column does not belong to the project.
      return Response.json(
        { ok: false, error: "Project or column not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, card }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
