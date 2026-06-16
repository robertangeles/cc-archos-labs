import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { VersionConflictError } from "@/lib/model-studio/canvas-service";
import {
  relationshipIdParamsSchema,
  relationshipUpdateSchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — single-relationship routes. Owner/admin mutates. A
// stale optimistic-lock write returns 409 { code: 'VERSION_CONFLICT', … }.
// ============================================================================

// PATCH /api/model-studio/:id/relationships/:relationshipId — update. Owner/admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = relationshipIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = relationshipUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const relationship = await canvas.updateRelationship(
        ctx.orgId,
        parsedParams.data.id,
        parsedParams.data.relationshipId,
        parsed.data,
      );
      if (!relationship) {
        return Response.json({ ok: false, error: "Relationship not found" }, { status: 404 });
      }
      return Response.json({ ok: true, relationship });
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return Response.json(
          { ok: false, code: "VERSION_CONFLICT", serverVersion: err.serverVersion },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// DELETE /api/model-studio/:id/relationships/:relationshipId — delete. Owner/admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = relationshipIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const removed = await canvas.deleteRelationship(
      ctx.orgId,
      parsedParams.data.id,
      parsedParams.data.relationshipId,
    );
    if (!removed) {
      return Response.json({ ok: false, error: "Relationship not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
