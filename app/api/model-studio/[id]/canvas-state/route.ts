import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { modelIdParamsSchema } from "@/lib/model-studio/validation";
import {
  canvasStateQuerySchema,
  canvasStatePutSchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — per-user canvas state (node positions, viewport,
// notation). This is the caller's OWN view state, scoped per (model, user,
// layer), so any member may read/write their own row — no owner|admin gate.
// The userId always comes from the session, never the request body.
// ============================================================================

// GET /api/model-studio/:id/canvas-state?layer= — the caller's saved state.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request);
    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }
    const url = new URL(request.url);
    const parsedQuery = canvasStateQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsedQuery.success) {
      return Response.json({ ok: false, error: "Invalid query" }, { status: 400 });
    }

    const state = await canvas.getCanvasState(
      ctx.orgId,
      parsedParams.data.id,
      auth.user.id,
      parsedQuery.data.layer,
    );
    if (state === null) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, state });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// PUT /api/model-studio/:id/canvas-state — upsert the caller's state. Any member.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = canvasStatePutSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const state = await canvas.saveCanvasState(
      ctx.orgId,
      parsedParams.data.id,
      auth.user.id,
      parsed.data,
    );
    if (state === null) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, state });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
