import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { VersionConflictError } from "@/lib/model-studio/canvas-service";
import { ModelConflictError } from "@/lib/model-studio/service";
import {
  attributeIdParamsSchema,
  attributeUpdateSchema,
  attributeReorderSchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — single-attribute routes. Owner/admin mutates. PATCH
// carries either a field update or a reorder ({ action: 'reorder', direction })
// — the reorder is folded in here rather than given its own endpoint. A stale
// optimistic-lock write returns 409 { code: 'VERSION_CONFLICT', serverVersion }.
// ============================================================================

const versionConflict = (err: VersionConflictError) =>
  Response.json(
    { ok: false, code: "VERSION_CONFLICT", serverVersion: err.serverVersion },
    { status: 409 },
  );

// PATCH /…/attributes/:attributeId — update or reorder. Owner/admin.
export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; entityId: string; attributeId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = attributeIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    const { id, entityId, attributeId } = parsedParams.data;
    const body = await request.json().catch(() => null);

    // Reorder is a distinct discriminated body folded into PATCH.
    if (body && typeof body === "object" && "action" in body) {
      const parsed = attributeReorderSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      try {
        const attribute = await canvas.reorderAttribute(
          ctx.orgId,
          id,
          entityId,
          attributeId,
          parsed.data.direction,
          parsed.data.version,
        );
        if (!attribute) {
          return Response.json({ ok: false, error: "Attribute not found" }, { status: 404 });
        }
        return Response.json({ ok: true, attribute });
      } catch (err) {
        if (err instanceof VersionConflictError) return versionConflict(err);
        throw err;
      }
    }

    const parsed = attributeUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    try {
      const attribute = await canvas.updateAttribute(
        ctx.orgId,
        id,
        entityId,
        attributeId,
        parsed.data,
      );
      if (!attribute) {
        return Response.json({ ok: false, error: "Attribute not found" }, { status: 404 });
      }
      return Response.json({ ok: true, attribute });
    } catch (err) {
      if (err instanceof VersionConflictError) return versionConflict(err);
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

// DELETE /…/attributes/:attributeId — delete. Owner/admin.
export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; entityId: string; attributeId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = attributeIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    const { id, entityId, attributeId } = parsedParams.data;

    const removed = await canvas.deleteAttribute(ctx.orgId, id, entityId, attributeId);
    if (!removed) {
      return Response.json({ ok: false, error: "Attribute not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
