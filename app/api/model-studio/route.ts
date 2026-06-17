import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as modelService from "@/lib/model-studio/service";
import { ModelConflictError } from "@/lib/model-studio/service";
import {
  modelCreateSchema,
  modelListQuerySchema,
} from "@/lib/model-studio/validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio — model collection routes (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/server/src/routes/model-studio.routes.ts +
// model-studio-model.controller.ts) and ADAPTED to this repo's org-context.
// Spresso scoped each model by "owned-by-user OR member-of-org" and let any
// authenticated user create; here access is scoped through the project's org
// (see lib/model-studio/service.ts) and the route mirrors the sibling
// app/api/projects/route.ts: any org member may list and create. The canvas
// (entities/attributes/relationships) routes are intentionally NOT migrated.
//
// Response shape matches this codebase ({ ok, ... }), not Spresso's
// { success, data }.
// ============================================================================

// GET /api/model-studio — list models in the caller's org. Any member.
export async function GET(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request);

    const rawQuery = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = modelListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 },
      );
    }

    const { models, total } = await modelService.listModels(
      ctx.orgId,
      parsed.data,
    );
    return Response.json({ ok: true, models, total });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/model-studio — create a model in a project. Any member.
export async function POST(request: Request) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });

    const body = await request.json().catch(() => null);
    const parsed = modelCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    try {
      const model = await modelService.createModel(
        ctx.orgId,
        auth.user.id,
        parsed.data,
      );
      // null = the target project is not in the caller's org (IDOR guard).
      if (!model) {
        return Response.json(
          { ok: false, error: "Project not found" },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, model }, { status: 201 });
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
