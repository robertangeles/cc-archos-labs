import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as modelService from "@/lib/model-studio/service";
import { ModelConflictError } from "@/lib/model-studio/service";
import {
  modelIdParamsSchema,
  modelUpdateSchema,
} from "@/lib/model-studio/validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio — single-model routes (LIST VIEW ONLY).
//
// Mirrors app/api/projects/[id]/route.ts: any org member may read; owner or
// admin may update/delete. Spresso let a model's owner edit it; this repo's
// service scopes by org (not owner), so update/delete are gated to owner|admin
// to prevent any member mutating another member's model. The route never
// reaches the canvas layer — that page is a stub.
// ============================================================================

// GET /api/model-studio/:id — fetch one model. Any member.
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

    const model = await modelService.getModel(ctx.orgId, parsedParams.data.id);
    if (!model) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, model });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// PATCH /api/model-studio/:id — update a model. Owner or admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = modelUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const model = await modelService.updateModel(
        ctx.orgId,
        parsedParams.data.id,
        parsed.data,
      );
      if (!model) {
        return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
      }
      return Response.json({ ok: true, model });
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

// DELETE /api/model-studio/:id — delete a model. Owner or admin.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const parsedParams = modelIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return Response.json({ ok: false, error: "Invalid model id" }, { status: 400 });
    }

    const removed = await modelService.deleteModel(ctx.orgId, parsedParams.data.id);
    if (!removed) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
