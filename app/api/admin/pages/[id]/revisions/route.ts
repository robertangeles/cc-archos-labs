// GET /api/admin/pages/[id]/revisions
//   List revisions for a page, newest first. Drives the admin "history"
//   view. Returns 200 + empty array if the page exists but has no
//   revisions (shouldn't happen — every create/update inserts one).

import { listRevisions } from "../../../../../../lib/pages";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const revisions = await listRevisions(id);
    return Response.json({ ok: true, data: revisions });
  } catch (err) {
    console.error("Pages [id]/revisions GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load revisions." },
      { status: 500 },
    );
  }
}
