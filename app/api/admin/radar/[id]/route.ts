// PATCH /api/admin/radar/[id] — set an item's Keep / Skip label, or clear it.
//
// Body: { decision: "keep"|"skip"|"clear", requestId: uuid, ifLatestLabelId?: uuid|null }
// The rules (append-only history, replayed request ids, stale check) live in
// lib/news-radar/labels.ts; this route validates and maps the result.
//
// Gated by proxy.ts (any signed-in admin session), like every /api/admin/** path.

import { z } from "zod";
import { assertSameOriginRequest, CsrfOriginError } from "../../../../../lib/auth/csrf";
import { getDb } from "../../../../../lib/db";
import { applyLabel } from "../../../../../lib/news-radar/labels";
import type {
  LabelConflict,
  LabelOk,
} from "../../../../../lib/news-radar/radar-page-types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const IdSchema = z.uuid();

const BodySchema = z.strictObject({
  decision: z.enum(["keep", "skip", "clear"]),
  requestId: z.uuid(),
  ifLatestLabelId: z.uuid().nullable().optional(),
});

function fail(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  // Second layer on top of SameSite=Lax, as lib/auth/csrf.ts asks of every
  // mutating admin route. A label is Rob's evaluation ground truth.
  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof CsrfOriginError) return fail("Forbidden.", 403);
    throw err;
  }

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return fail("Invalid item id.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body.", 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail("Invalid label request.", 400);

  try {
    const result = await applyLabel(getDb(), id, parsed.data);
    switch (result.kind) {
      case "ok":
        return Response.json({
          ok: true,
          label: result.label,
          latestLabelId: result.latestLabelId,
          changed: result.changed,
        } satisfies LabelOk);
      case "conflict":
        return Response.json(
          {
            ok: false,
            error: "conflict",
            current: result.current,
            latestLabelId: result.latestLabelId,
          } satisfies LabelConflict,
          { status: 409 },
        );
      case "not-found":
        return fail("Item not found.", 404);
      case "not-scored":
        return fail("This item has not been scored yet.", 422);
      case "request-id-reused":
        return fail("That request id was already used for a different change.", 422);
    }
  } catch (err) {
    // Name only: a database error message can carry row values.
    console.error("[admin/radar PATCH] failed:", err instanceof Error ? err.name : "unknown");
    return fail("Could not save the label.", 500);
  }
}
