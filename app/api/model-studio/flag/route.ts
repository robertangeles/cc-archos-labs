import { z } from "zod";
import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import {
  isModelStudioEnabled,
  setModelStudioEnabled,
} from "@/lib/model-studio/flag";

export const runtime = "nodejs";

// ============================================================================
// Model Studio — feature-flag routes (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/server/src/routes/model-studio.routes.ts,
// the /flag endpoints) and ADAPTED to this repo's org-context auth and
// { ok, ... } response envelope.
//
//   GET /api/model-studio/flag  → read the flag. Any authenticated member.
//   PUT /api/model-studio/flag  → set the flag. Owner or admin only.
//
// Spresso gated the setter with requireRole('Administrator'); the faithful
// org-context adaptation is owner|admin, matching the model PATCH/DELETE gating
// in app/api/model-studio/[id]/route.ts.
// ============================================================================

// GET /api/model-studio/flag — read the flag. Any member.
export async function GET(request: Request) {
  try {
    await requireOrgContext(request);
    const enabled = await isModelStudioEnabled();
    return Response.json({ ok: true, enabled });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

const setFlagSchema = z.object({ enabled: z.boolean() });

// PUT /api/model-studio/flag — set the flag. Owner or admin.
export async function PUT(request: Request) {
  try {
    const { ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");

    const body = await request.json().catch(() => null);
    const parsed = setFlagSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "enabled must be a boolean" },
        { status: 400 },
      );
    }

    const enabled = await setModelStudioEnabled(parsed.data.enabled);
    return Response.json({ ok: true, enabled });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
