// POST /api/admin/pages/[id]/restore
//   Restore a previously archived page (clears archived_at). Body is
//   empty. Returns the un-archived row.
//
// Gated by proxy.ts.

import { restoreFromArchive } from "../../../../../../lib/pages";
import { PageNotFoundError } from "../../../../../../lib/pages/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const restored = await restoreFromArchive(id);
    return Response.json({ ok: true, data: restored });
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Pages [id]/restore crash:", err);
    return Response.json(
      { ok: false, error: "Could not restore page." },
      { status: 500 },
    );
  }
}
