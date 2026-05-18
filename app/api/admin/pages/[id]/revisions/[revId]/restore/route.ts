// POST /api/admin/pages/[id]/revisions/[revId]/restore
//   Restore the content of revision [revId] to page [id]. Creates a new
//   revision row documenting the restore (audit trail preserved).
//
// Gated by proxy.ts.

import { restoreRevision } from "../../../../../../../../lib/pages";
import {
  PageNotFoundError,
  RevisionNotFoundError,
} from "../../../../../../../../lib/pages/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; revId: string }>;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { id, revId } = await params;
  try {
    const result = await restoreRevision(id, revId);
    return Response.json({ ok: true, data: result });
  } catch (err) {
    if (
      err instanceof PageNotFoundError ||
      err instanceof RevisionNotFoundError
    ) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Revisions restore crash:", err);
    return Response.json(
      { ok: false, error: "Could not restore revision." },
      { status: 500 },
    );
  }
}
