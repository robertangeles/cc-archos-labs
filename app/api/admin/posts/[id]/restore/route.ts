// POST /api/admin/posts/[id]/restore
//   Inverse of DELETE — clears archived_at. Status preserved.
//   Gated by proxy.ts.

import { restoreFromArchive } from "../../../../../../lib/posts-admin";
import { PostNotFoundError } from "../../../../../../lib/posts-admin/types";

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
    if (err instanceof PostNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Posts [id] restore crash:", err);
    return Response.json(
      { ok: false, error: "Could not restore post." },
      { status: 500 },
    );
  }
}
