import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as canvas from "@/lib/model-studio/canvas-service";
import { modelIdParamsSchema } from "@/lib/model-studio/validation";

export const runtime = "nodejs";

// ============================================================================
// Model Studio canvas — batch attribute load for a whole model (the canvas
// preload, so the client fetches every entity's attributes in one request
// rather than N). Any member reads. Model-not-in-org → 404.
// ============================================================================

// GET /api/model-studio/:id/attributes — every attribute in the model.
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

    const attributes = await canvas.listModelAttributes(
      ctx.orgId,
      parsedParams.data.id,
    );
    if (attributes === null) {
      return Response.json({ ok: false, error: "Model not found" }, { status: 404 });
    }
    return Response.json({ ok: true, attributes });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
