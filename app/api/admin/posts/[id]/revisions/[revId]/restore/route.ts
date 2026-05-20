// POST /api/admin/posts/[id]/revisions/[revId]/restore
//   Restore a prior revision's content. Slug + status + scheduling +
//   visibility are NOT touched — restore is a content-only operation.
//   Creates a NEW revision row reflecting the restore so the audit
//   trail shows when + by whom.
//   Gated by proxy.ts.

import { restoreRevision } from "../../../../../../../../lib/posts-admin";
import {
  PostNotFoundError,
  RevisionNotFoundError,
} from "../../../../../../../../lib/posts-admin/types";

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
    if (err instanceof RevisionNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    if (err instanceof PostNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Posts revision restore crash:", err);
    return Response.json(
      { ok: false, error: "Could not restore revision." },
      { status: 500 },
    );
  }
}
