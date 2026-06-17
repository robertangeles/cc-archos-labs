import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { ModelConflictError } from "@/lib/model-studio/service";
import {
  entityIdParamsSchema,
  attributeCreateSchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — attribute collection routes. Any member reads; owner
// or admin creates. A null service result means the entity is not in the
// caller's org → 404.
// ============================================================================

// GET /api/model-studio/:id/entities/:entityId/attributes — list. Any member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const parsedParams = entityIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const attributes = await canvas.listAttributes(
      ctx.orgId,
      parsedParams.data.id,
      parsedParams.data.entityId,
    );
    if (attributes === null) {
      return Response.json({ ok: false, error: "Entity not found" }, { status: 404 });
    }
    return Response.json({ ok: true, attributes });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/model-studio/:id/entities/:entityId/attributes — create. Owner/admin.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = entityIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = attributeCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const attribute = await canvas.createAttribute(
        ctx.orgId,
        parsedParams.data.id,
        parsedParams.data.entityId,
        auth.user.id,
        parsed.data,
      );
      if (!attribute) {
        return Response.json({ ok: false, error: "Entity not found" }, { status: 404 });
      }
      return Response.json({ ok: true, attribute }, { status: 201 });
    } catch (err) {
      if (err instanceof ModelConflictError) {
        return Response.json({ ok: false, error: err.message }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
