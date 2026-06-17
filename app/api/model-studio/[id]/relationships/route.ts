import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { InvalidEndpointError } from "@/lib/model-studio/canvas-service";
import { modelIdParamsSchema } from "@/lib/model-studio/validation";
import { relationshipCreateSchema } from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — relationship collection routes. Any member reads; owner
// or admin creates. A cross-model endpoint is rejected as 400; a model not in
// the caller's org is 404.
// ============================================================================

// GET /api/model-studio/:id/relationships — list. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }

    const relationships = await canvas.listRelationships(
      ctx.orgId,
      parsedParams.data.id,
    );
    if (relationships === null) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, relationships });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/model-studio/:id/relationships — create. Owner or admin.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = relationshipCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const relationship = await canvas.createRelationship(
        ctx.orgId,
        parsedParams.data.id,
        auth.user.id,
        parsed.data,
      );
      if (!relationship) {
        return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
      }
      return Response.json({ ok: true, relationship }, { status: 201 });
    } catch (err) {
      if (err instanceof InvalidEndpointError) {
        return Response.json({ ok: false, error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
