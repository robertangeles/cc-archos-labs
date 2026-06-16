import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { ModelConflictError } from "@/lib/model-studio/service";
import { modelIdParamsSchema } from "@/lib/model-studio/validation";
import {
  entityCreateSchema,
  layerListQuerySchema,
} from "@/lib/model-studio/canvas-validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — entity collection routes.
//
// Same contract as app/api/model-studio/[id]/route.ts: any org member may read;
// owner or admin may create. The service scopes every query through the model's
// org, so a null result means "model not in this org" → 404.
// ============================================================================

// GET /api/model-studio/:id/entities?layer= — list a model's entities. Any member.
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
    const url = new URL(request.url);
    const parsedQuery = layerListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsedQuery.success) {
      return Response.json({ ok: false, error: "Invalid query" }, { status: 400 });
    }

    const entities = await canvas.listEntities(
      ctx.orgId,
      parsedParams.data.id,
      parsedQuery.data.layer,
    );
    if (entities === null) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, entities });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/model-studio/:id/entities — create an entity. Owner or admin.
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
    const parsed = entityCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const entity = await canvas.createEntity(
        ctx.orgId,
        parsedParams.data.id,
        auth.user.id,
        parsed.data,
      );
      if (!entity) {
        return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
      }
      return Response.json({ ok: true, entity }, { status: 201 });
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
