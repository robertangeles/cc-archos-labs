import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { VersionConflictError } from "@/lib/model-studio/canvas-service";
import { ModelConflictError } from "@/lib/model-studio/service";
import {
  entityIdParamsSchema,
  entityUpdateSchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — single-entity routes. Any member reads; owner or admin
// mutates. A stale PATCH (optimistic lock) returns 409 with the current
// serverVersion so the client can refresh and retry.
// ============================================================================

// GET /api/model-studio/:id/entities/:entityId — fetch one entity. Any member.
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

    const entity = await canvas.getEntity(
      ctx.orgId,
      parsedParams.data.id,
      parsedParams.data.entityId,
    );
    if (!entity) {
      return Response.json({ ok: false, error: "Entity not found" }, { status: 404 });
    }
    return Response.json({ ok: true, entity });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// PATCH /api/model-studio/:id/entities/:entityId — update an entity. Owner/admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = entityIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = entityUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const entity = await canvas.updateEntity(
        ctx.orgId,
        parsedParams.data.id,
        parsedParams.data.entityId,
        parsed.data,
      );
      if (!entity) {
        return Response.json({ ok: false, error: "Entity not found" }, { status: 404 });
      }
      return Response.json({ ok: true, entity });
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return Response.json(
          { ok: false, code: "VERSION_CONFLICT", serverVersion: err.serverVersion },
          { status: 409 },
        );
      }
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

// DELETE /api/model-studio/:id/entities/:entityId — delete an entity. Owner/admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = entityIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }

    const removed = await canvas.deleteEntity(
      ctx.orgId,
      parsedParams.data.id,
      parsedParams.data.entityId,
    );
    if (!removed) {
      return Response.json({ ok: false, error: "Entity not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
