// GET /api/admin/posts/[id]/revisions
//   List every revision row for the post, newest first. Drives the
//   admin revision-history view + the restore-revision flow.
//   Gated by proxy.ts.

import { listRevisionsForPost } from "../../../../../../lib/posts-admin";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const revisions = await listRevisionsForPost(id);
    return Response.json({ ok: true, data: revisions });
  } catch (err) {
    console.error("Posts [id] revisions GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load revisions." },
      { status: 500 },
    );
  }
}
