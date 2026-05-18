// GET /api/admin/pages/[id]/blocks
//   List the blocks for a page in render order (position ASC). Drives
//   the admin BlocksEditor's initial state. Empty list for long_form
//   pages.
//
// Gated by proxy.ts.

import { listBlocksForPage } from "../../../../../../lib/pages";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const blocks = await listBlocksForPage(id);
    return Response.json({ ok: true, data: blocks });
  } catch (err) {
    console.error("Pages [id]/blocks GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load blocks." },
      { status: 500 },
    );
  }
}
